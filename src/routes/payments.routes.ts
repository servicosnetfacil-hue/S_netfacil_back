import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { query } from "../config/db";
import { authenticate, requireAdmin, AuthenticatedRequest } from "../middleware/auth";
import { parsePaymentProofPdf } from "../services/pdf-parser.service";
import {
  sendAndLogNotification,
  messageTemplates,
  getAdminPhone,
  getConfiguredNotificationNumbers,
} from "../services/whatsapp.service";

const router = Router();


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf" && !file.originalname.toLowerCase().endsWith(".pdf")) {
      return cb(new Error("Apenas ficheiros PDF são permitidos para envio de comprovativo."));
    }
    cb(null, true);
  },
});

// POST /payments — cliente envia comprovativo PDF (sem gravação de ficheiro no disco)
router.post("/", authenticate, upload.single("proof"), async (req: AuthenticatedRequest, res) => {
  try {
    const { planId, method } = req.body;

  if (!planId || !method || !req.file) {
    return res.status(400).json({ error: "Plano, método e comprovativo PDF são obrigatórios." });
  }
  if (!["express", "bank_transfer"].includes(method)) {
    return res.status(400).json({ error: "Método de pagamento inválido." });
  }

  const [initialPlan] = await query<any>(`SELECT * FROM plans WHERE id = $1`, [planId]);
  if (!initialPlan) return res.status(404).json({ error: "Plano não encontrado." });

  const [user] = await query<any>(`SELECT * FROM users WHERE id = $1`, [req.user!.id]);
  if (!user) return res.status(404).json({ error: "Utilizador não encontrado." });

  const [subscription] = await query<any>(
    `SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT 1`,
    [req.user!.id]
  );

  // Carregar configurações de pagamento da empresa
  const settingsRows = await query<any>(`SELECT key, value FROM company_settings`);
  const companySettings: Record<string, string> = {
    payment_entity: "10116",
    payment_reference: "929754355",
  };
  settingsRows.forEach((r) => {
    companySettings[r.key] = r.value;
  });

  let status: "pending" | "approved" | "rejected" = "pending";
  let rejectionReason: string | null = null;
  let autoValidated = false;
  let accountSuspended = false;
  let rejectedAttempts = 0;

  let extractedAmount: number | null = null;
  let extractedTransId: string | null = null;
  let extractedEntity: string | null = null;
  let extractedReference: string | null = null;
  let matchedPlan = initialPlan;

  // Processamento automático diretamente do Buffer em memória (sem salvar ficheiro em disco)
  const extracted = await parsePaymentProofPdf(req.file.buffer);
  extractedAmount = extracted.amount;
  extractedTransId = extracted.transactionId;
  extractedEntity = extracted.entity;
  extractedReference = extracted.reference;

  if (extractedEntity || extractedReference || extractedTransId || extractedAmount) {
    const configuredEntity = companySettings.payment_entity?.trim();
    const configuredRef = companySettings.payment_reference?.trim();

    // REGRA 1: Verificar Entidade e Referência
    const entityMatches = !configuredEntity || (extractedEntity && extractedEntity === configuredEntity);
    const refMatches = !configuredRef || (extractedReference && extractedReference === configuredRef);

    if (!entityMatches || !refMatches) { 
      status = "rejected";
      rejectionReason = `Tentativa de Burla: As coordenadas do comprovativo (Entidade: ${extractedEntity ?? "N/A"}, Ref: ${extractedReference ?? "N/A"}) não correspondem às coordenadas oficiais (Entidade: ${configuredEntity}, Ref: ${configuredRef}). O pagamento foi considerado inválido.`;
    } else {
      // REGRA 2: Verificar se o Montante corresponde a algum plano ativo
      if (!extractedAmount) {
        status = "rejected";
        rejectionReason = "Não foi possível validar o comprovativo.";
      } else {
        const [foundPlan] = await query<any>(
          `SELECT * FROM plans WHERE is_active = true AND price_aoa = $1 LIMIT 1`,
          [extractedAmount]
        );

        if (!foundPlan) {
          status = "rejected";
          rejectionReason = `O montante do comprovativo (${extractedAmount.toLocaleString("pt-AO")} AOA) não corresponde ao valor exato de nenhum plano ativo. O pagamento foi recusado. Certifique-se de enviar o comprovativo correto ou contacte o suporte.`;
        } else {
          matchedPlan = foundPlan;

          // REGRA 3: Verificar se a transação já existe na base de dados 
          if (!extractedTransId) {
            status = "rejected";
            rejectionReason = "Não foi possível validar o comprovativo.";
          } else {
            const [existingPayment] = await query<any>(
              `SELECT id FROM payments WHERE transaction_id = $1 AND status != 'rejected' LIMIT 1`,
              [extractedTransId]
            );

            if (existingPayment) {
              status = "rejected";
              rejectionReason = `Transação Invalida, submeta o comprovativo correto. `;
            } else {
              // TUDO VÁLIDO -> APROVADO AUTOMATICAMENTE!
              status = "approved";
              autoValidated = true;
            }
          }
        }
      }
    }
  } else {
    status = "rejected";
    rejectionReason = "Não foi possível validar a transferencia. Certifique-se de enviar o comprovativo PDF oficial.";
  }

  let finalSubId = subscription?.id ?? null;


  // Se foi APROVADO AUTOMATICAMENTE, atualiza/estende a subscrição
  if (status === "approved") {
    const [currentSub] = await query<any>(
      `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT 1`,
      [req.user!.id]
    );

    let newExpiresAt: Date;
    if (currentSub && new Date(currentSub.expires_at) > new Date()) {
      const currentExpiry = new Date(currentSub.expires_at);
      currentExpiry.setDate(currentExpiry.getDate() + matchedPlan.duration_days);
      newExpiresAt = currentExpiry;

      await query(
        `UPDATE subscriptions SET plan_id = $1, status = 'active', expires_at = $2 WHERE id = $3`,
        [matchedPlan.id, newExpiresAt.toISOString(), currentSub.id]
      );
      finalSubId = currentSub.id;
    } else {
      newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + matchedPlan.duration_days);

      if (currentSub) {
        await query(
          `UPDATE subscriptions SET plan_id = $1, status = 'active', started_at = NOW(), expires_at = $2 WHERE id = $3`,
          [matchedPlan.id, newExpiresAt.toISOString(), currentSub.id]
        );
        finalSubId = currentSub.id;
      } else {
        const [newSub] = await query<any>(
          `INSERT INTO subscriptions (user_id, plan_id, status, started_at, expires_at)
           VALUES ($1, $2, 'active', NOW(), $3) RETURNING id`,
          [req.user!.id, matchedPlan.id, newExpiresAt.toISOString()]
        );
        finalSubId = newSub.id;
      }
    }

    const formattedExpiry = newExpiresAt.toLocaleDateString("pt-AO");
    const formattedAmount = (extractedAmount ?? matchedPlan.price_aoa).toLocaleString("pt-AO");

    // Enviar WhatsApp ao Cliente
    const clientMsg = messageTemplates.paymentApprovedClient(
      user.full_name,
      matchedPlan.name,
      formattedAmount,
      formattedExpiry
    );
    await sendAndLogNotification({
      userId: user.id,
      subscriptionId: finalSubId,
      channel: "client",
      type: "payment_approved_client",
      phone: user.phone,
      message: clientMsg,
    }).catch((e) => console.error("[WhatsApp] Erro ao enviar confirmação ao cliente:", e));

    // Enviar WhatsApp ao Admin
    const adminPhone = getAdminPhone();
    if (adminPhone) {
      const adminMsg = messageTemplates.paymentApprovedAdmin(
        user.full_name,
        user.phone,
        matchedPlan.name,
        formattedAmount,
        extractedTransId ?? "N/A",
        formattedExpiry
      );
      await sendAndLogNotification({
        userId: null,
        subscriptionId: finalSubId,
        channel: "admin",
        type: "payment_approved_admin",
        phone: adminPhone,
        message: adminMsg,
      }).catch((e) => console.error("[WhatsApp] Erro ao enviar notificação de pagamento ao admin:", e));
    }
  } else if (status === "rejected" && rejectionReason) {
    // Se foi REJEITADO AUTOMATICAMENTE, envia WhatsApp ao cliente
    const clientMsg = messageTemplates.paymentRejectedClient(user.full_name, rejectionReason);
    await sendAndLogNotification({
      userId: user.id,
      subscriptionId: finalSubId,
      channel: "client",
      type: "payment_rejected_client",
      phone: user.phone,
      message: clientMsg,
    }).catch((e) => console.error("[WhatsApp] Erro ao enviar rejeição ao cliente:", e));
  }

  const [payment] = await query<any>(
    `INSERT INTO payments (
       user_id, subscription_id, plan_id, amount_aoa, method, proof_file_url,
       transaction_id, extracted_entity, extracted_reference, extracted_amount,
       auto_validated, status, rejection_reason, reviewed_at
     )
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11::payment_status,$12, CASE WHEN $11::payment_status != 'pending' THEN NOW() ELSE NULL END)
     RETURNING *`,

    [
      req.user!.id,
      finalSubId,
      matchedPlan.id,
      extractedAmount ?? matchedPlan.price_aoa,
      method,
      extractedTransId,
      extractedEntity,
      extractedReference,
      extractedAmount,
      autoValidated,
      status,
      rejectionReason,
    ]
  );

  if (status === "approved") {
    await query(`UPDATE users SET rejected_proof_attempts = 0 WHERE id = $1`, [user.id]);
    const activationNumbers = await getConfiguredNotificationNumbers("internet_activation_numbers");
    const activationMessage = `ACTIVAR INTERNET: ${user.full_name} (${user.phone}) pagou o plano ${matchedPlan.name}. Transação: ${extractedTransId ?? "N/A"}.`;
    for (const number of activationNumbers) {
      await sendAndLogNotification({
        userId: user.id,
        subscriptionId: finalSubId,
        channel: "admin",
        type: "payment_approved_admin",
        phone: number,
        message: activationMessage,
      }).catch((e) => console.error("[WhatsApp] Erro ao notificar activação:", e));
    }
  } else if (status === "rejected") {
    const [attemptRow] = await query<any>(
      `UPDATE users SET rejected_proof_attempts = rejected_proof_attempts + 1
       WHERE id = $1
       RETURNING rejected_proof_attempts`,
      [user.id]
    );
    const attempts = Number(attemptRow?.rejected_proof_attempts ?? 0);
    if (attempts >= 3) {
      await query(`UPDATE users SET is_active = false WHERE id = $1`, [user.id]);
      accountSuspended = true;
      rejectedAttempts = attempts;
      const suspensionMessage = messageTemplates.accountSuspendedClient(user.full_name);
      await sendAndLogNotification({
        userId: user.id,
        subscriptionId: finalSubId,
        channel: "client",
        type: "account_suspended_client",
        phone: user.phone,
        message: suspensionMessage,
      }).catch((e) => console.error("[WhatsApp] Erro ao notificar suspensão:", e));
    }
  }


  return res.status(201).json({
    ...payment,
    accountSuspended,
    rejectedAttempts,
  });
  } catch (err: any) {
    console.error("[Payments] Erro no processamento do comprovativo:", err);
    return res.status(500).json({ error: err?.message ?? "Erro interno ao processar o comprovativo." });
  }
});

// GET /payments — histórico completo de pagamentos para o admin
router.get("/", authenticate, requireAdmin, async (req, res) => {
  const { phone, status } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];
  if (phone) {
    params.push(`%${phone}%`);
    conditions.push(`u.phone ILIKE $${params.length}`);
  }
  if (status && ["pending", "approved", "rejected"].includes(String(status))) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const payments = await query(
    `SELECT p.id, p.user_id, p.amount_aoa, p.method, p.status, p.rejection_reason,
            p.transaction_id, p.extracted_entity, p.extracted_reference,
            p.extracted_amount, p.auto_validated, p.created_at,
            u.full_name, u.phone, pl.name AS plan_name
     FROM payments p
     JOIN users u ON u.id = p.user_id
     JOIN plans pl ON pl.id = p.plan_id
     ${where}
     ORDER BY p.created_at DESC`,
    params
  );
  return res.json(payments);
});


// GET /payments/me — histórico do cliente autenticado
router.get("/me", authenticate, async (req: AuthenticatedRequest, res) => {
  const payments = await query(
    `SELECT p.id, p.amount_aoa, p.method, p.status, p.rejection_reason, p.created_at,
            pl.name AS plan_name, p.transaction_id, p.auto_validated
     FROM payments p JOIN plans pl ON pl.id = p.plan_id
     WHERE p.user_id = $1 ORDER BY p.created_at DESC`,
    [req.user!.id]
  );
  return res.json(payments);
});

// GET /payments/pending — fila de validação (admin)
router.get("/pending", authenticate, requireAdmin, async (_req, res) => {
  const payments = await query(
    `SELECT p.id, p.amount_aoa, p.method, p.proof_file_url, p.created_at,
            p.transaction_id, p.extracted_entity, p.extracted_reference, p.extracted_amount,
            u.id AS user_id, u.full_name, u.phone, pl.name AS plan_name
     FROM payments p
     JOIN users u ON u.id = p.user_id
     JOIN plans pl ON pl.id = p.plan_id
     WHERE p.status = 'pending'
     ORDER BY p.created_at ASC`
  );
  return res.json(payments);
});

// PATCH /payments/:id/approve — aprova e estende a subscrição
router.patch("/:id/approve", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;

  const [payment] = await query<any>(
    `SELECT p.*, pl.name AS plan_name, pl.duration_days, u.full_name, u.phone
     FROM payments p
     JOIN plans pl ON pl.id = p.plan_id
     JOIN users u ON u.id = p.user_id
     WHERE p.id = $1`,
    [id]
  );
  if (!payment) return res.status(404).json({ error: "Pagamento não encontrado." });
  if (payment.status !== "pending") return res.status(409).json({ error: "Pagamento já foi processado." });

  const [currentSub] = await query<any>(
    `SELECT * FROM subscriptions WHERE id = $1`,
    [payment.subscription_id]
  );

  let newExpiresAt: Date;
  let subscriptionId = payment.subscription_id;

  if (currentSub && new Date(currentSub.expires_at) > new Date()) {
    const currentExpiry = new Date(currentSub.expires_at);
    currentExpiry.setDate(currentExpiry.getDate() + payment.duration_days);
    newExpiresAt = currentExpiry;

    await query(
      `UPDATE subscriptions SET plan_id = $1, status = 'active',
              expires_at = $2
       WHERE id = $3`,
      [payment.plan_id, newExpiresAt.toISOString(), currentSub.id]
    );
  } else if (currentSub) {
    newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + payment.duration_days);

    await query(
      `UPDATE subscriptions SET plan_id = $1, status = 'active', started_at = NOW(),
              expires_at = $2
       WHERE id = $3`,
      [payment.plan_id, newExpiresAt.toISOString(), currentSub.id]
    );
  } else {
    newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + payment.duration_days);

    const [newSub] = await query<any>(
      `INSERT INTO subscriptions (user_id, plan_id, status, started_at, expires_at)
       VALUES ($1,$2,'active',NOW(), $3) RETURNING id`,
      [payment.user_id, payment.plan_id, newExpiresAt.toISOString()]
    );
    subscriptionId = newSub.id;
  }

  const [updatedPayment] = await query<any>(
    `UPDATE payments SET status='approved', subscription_id=$1, reviewed_by=$2, reviewed_at=NOW()
     WHERE id=$3 RETURNING *`,
    [subscriptionId, req.user!.id, id]
  );

  const formattedExpiry = newExpiresAt.toLocaleDateString("pt-AO");
  const formattedAmount = Number(payment.amount_aoa).toLocaleString("pt-AO");

  // Notificar cliente via WhatsApp
  const clientMsg = messageTemplates.paymentApprovedClient(
    payment.full_name,
    payment.plan_name,
    formattedAmount,
    formattedExpiry
  );
  await sendAndLogNotification({
    userId: payment.user_id,
    subscriptionId,
    channel: "client",
    type: "payment_approved_client",
    phone: payment.phone,
    message: clientMsg,
  }).catch((e) => console.error("[WhatsApp] Erro ao enviar aprovação manual ao cliente:", e));

  const activationNumbers = await getConfiguredNotificationNumbers("internet_activation_numbers");
  const activationMessage = `ACTIVAR INTERNET: ${payment.full_name} (${payment.phone}) pagou o plano ${payment.plan_name}.`;
  for (const number of activationNumbers) {
    await sendAndLogNotification({
      userId: payment.user_id,
      subscriptionId,
      channel: "admin",
      type: "payment_approved_admin",
      phone: number,
      message: activationMessage,
    }).catch((e) => console.error("[WhatsApp] Erro ao notificar activação manual:", e));
  }

  return res.json(updatedPayment);
});

// PATCH /payments/:id/reject — rejeita com motivo
router.patch("/:id/reject", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "É obrigatório indicar o motivo da rejeição." });

  const [payment] = await query<any>(
    `SELECT p.*, u.full_name, u.phone FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    [id]
  );

  const [updatedPayment] = await query<any>(
    `UPDATE payments SET status='rejected', rejection_reason=$1, reviewed_by=$2, reviewed_at=NOW()
     WHERE id=$3 AND status='pending' RETURNING *`,
    [reason, req.user!.id, id]
  );
  if (!updatedPayment) return res.status(404).json({ error: "Pagamento não encontrado ou já processado." });

  if (payment) {
    const clientMsg = messageTemplates.paymentRejectedClient(payment.full_name, reason);
    await sendAndLogNotification({
      userId: payment.user_id,
      subscriptionId: payment.subscription_id,
      channel: "client",
      type: "payment_rejected_client",
      phone: payment.phone,
      message: clientMsg,
    }).catch((e) => console.error("[WhatsApp] Erro ao enviar rejeição manual ao cliente:", e));

    const [attemptRow] = await query<any>(
      `UPDATE users SET rejected_proof_attempts = rejected_proof_attempts + 1
       WHERE id = $1 RETURNING rejected_proof_attempts`,
      [payment.user_id]
    );
    if (Number(attemptRow?.rejected_proof_attempts ?? 0) >= 3) {
      await query(`UPDATE users SET is_active = false WHERE id = $1`, [payment.user_id]);
      await sendAndLogNotification({
        userId: payment.user_id,
        subscriptionId: payment.subscription_id,
        channel: "client",
        type: "account_suspended_client",
        phone: payment.phone,
        message: messageTemplates.accountSuspendedClient(payment.full_name),
      }).catch((e) => console.error("[WhatsApp] Erro ao notificar suspensão manual:", e));
    }
  }

  return res.json(updatedPayment);
});


export default router;

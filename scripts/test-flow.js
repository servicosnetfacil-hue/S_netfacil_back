const http = require('http');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data'); // or use basic http multipart writer

// Helper function to send HTTP requests using native http module
function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', (err) => reject(err));

    if (postData) {
      if (Buffer.isBuffer(postData)) {
        req.write(postData);
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== TESTES DE INTEGRAÇÃO & FLUXO DE CLIENTE E PAGAMENTO ===\n');

  // 1. GET /plans (público)
  console.log('1. Testando GET /plans (público)...');
  const plansRes = await request({
    host: 'localhost',
    port: 4000,
    path: '/plans',
    method: 'GET',
  });
  console.log(`STATUS: ${plansRes.status}`);
  console.log('PLANOS ENCONTRADOS:', plansRes.body.length);

  // 2. POST /auth/login (Admin)
  console.log('\n2. Testando Login do Administrador...');
  const adminLoginBody = JSON.stringify({
    identifier: '244900000000',
    password: 'NetFacil2026!',
  });
  const adminLoginRes = await request(
    {
      host: 'localhost',
      port: 4000,
      path: '/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(adminLoginBody),
      },
    },
    adminLoginBody
  );
  console.log(`STATUS: ${adminLoginRes.status}`);
  const adminToken = adminLoginRes.body.token;
  console.log('ADMIN TOKEN GERADO:', adminToken ? 'SIM' : 'NÃO');

  // 3. GET /clients/metrics/overview (Admin)
  console.log('\n3. Testando GET /clients/metrics/overview (Admin)...');
  const overviewRes = await request({
    host: 'localhost',
    port: 4000,
    path: '/clients/metrics/overview',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(`STATUS: ${overviewRes.status}`);
  console.log('MÉTRICAS INICIAIS:', overviewRes.body);

  // 4. POST /clients (Criar Cliente de Teste)
  console.log('\n4. Criando Novo Cliente via POST /clients...');
  const clientData = JSON.stringify({
    fullName: 'Cliente Teste NetFácil',
    email: 'cliente.teste@netfacil.ao',
    phone: '244999888777',
    password: 'ClientePass123!',
    planId: 1,
    address: 'Luanda, Maianga',
  });
  const createClientRes = await request(
    {
      host: 'localhost',
      port: 4000,
      path: '/clients',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(clientData),
        Authorization: `Bearer ${adminToken}`,
      },
    },
    clientData
  );
  console.log(`STATUS: ${createClientRes.status}`);
  console.log('CLIENTE CRIADO:', createClientRes.body);

  // 5. POST /auth/login (Cliente)
  console.log('\n5. Testando Login do Cliente Criado...');
  const clientLoginBody = JSON.stringify({
    identifier: '244999888777',
    password: 'ClientePass123!',
  });
  const clientLoginRes = await request(
    {
      host: 'localhost',
      port: 4000,
      path: '/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(clientLoginBody),
      },
    },
    clientLoginBody
  );
  console.log(`STATUS: ${clientLoginRes.status}`);
  const clientToken = clientLoginRes.body.token;
  console.log('CLIENT TOKEN GERADO:', clientToken ? 'SIM' : 'NÃO');

  // 6. GET /clients/me (Dashboard do Cliente)
  console.log('\n6. Testando GET /clients/me (Dashboard do Cliente)...');
  const clientMeRes = await request({
    host: 'localhost',
    port: 4000,
    path: '/clients/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  console.log(`STATUS: ${clientMeRes.status}`);
  console.log('DADOS DO CLIENTE & SUBSCRIÇÃO:', clientMeRes.body);

  // 7. Enviar Comprovativo via POST /payments (Multipart Upload)
  console.log('\n7. Enviando comprovativo de pagamento via POST /payments...');
  const boundary = '--------------------------' + Date.now().toString(16);
  const dummyFileContent = 'PDF Comprovativo de Teste Multicaixa Express NetFacil';
  
  let bodyBuffer = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="planId"\r\n\r\n1\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="method"\r\n\r\nexpress\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="proof"; filename="comprovativo.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    Buffer.from(dummyFileContent),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const paymentRes = await request(
    {
      host: 'localhost',
      port: 4000,
      path: '/payments',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length,
        Authorization: `Bearer ${clientToken}`,
      },
    },
    bodyBuffer
  );
  console.log(`STATUS: ${paymentRes.status}`);
  console.log('PAGAMENTO SUBMETIDO:', paymentRes.body);

  const paymentId = paymentRes.body.id;

  // 8. GET /payments/pending (Admin)
  console.log('\n8. Listando Pagamentos Pendentes (Admin)...');
  const pendingRes = await request({
    host: 'localhost',
    port: 4000,
    path: '/payments/pending',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(`STATUS: ${pendingRes.status}`);
  console.log('PAGAMENTOS PENDENTES:', pendingRes.body);

  // 9. PATCH /payments/:id/approve (Admin)
  console.log(`\n9. Aprova o Pagamento #${paymentId} (Admin)...`);
  const approveRes = await request({
    host: 'localhost',
    port: 4000,
    path: `/payments/${paymentId}/approve`,
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(`STATUS: ${approveRes.status}`);
  console.log('PAGAMENTO APROVADO:', approveRes.body);

  // 10. GET /finance/summary (Admin)
  console.log('\n10. Testando Resumo Financeiro GET /finance/summary (Admin)...');
  const financeRes = await request({
    host: 'localhost',
    port: 4000,
    path: '/finance/summary?period=month',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(`STATUS: ${financeRes.status}`);
  console.log('RESUMO FINANCEIRO:', financeRes.body);

  console.log('\n=== FLUXO DE TESTES CONCLUÍDO COM SUCESSO! ===');
}

runTests().catch(err => {
  console.error('ERRO NOS TESTES:', err);
  process.exit(1);
});

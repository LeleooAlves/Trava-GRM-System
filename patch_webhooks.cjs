const fs = require('fs');
const https = require('https');

const imgBuffer = fs.readFileSync('logo.png');
const base64Img = imgBuffer.toString('base64');
const dataUri = `data:image/png;base64,${base64Img}`;

const payload = JSON.stringify({
  name: "Atualizações de projeto",
  avatar: dataUri
});

const urls = [
  'https://discord.com/api/webhooks/1442949842820141281/zqt-Lyone9fzgSj58GmKzMgrREf9O1gF_t5qHpOUeWmZvCHl72G7_oGcZSnjI_JvR3x5',
  'https://discord.com/api/webhooks/1442947625715368067/3dBIBIUFaHn32fDQK37d7XXBiryMgEmKDXdKBRLmqyCquz_-UH1VNCJr4gU0br4lbwUF'
];

urls.forEach(url => {
  const req = https.request(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    console.log('Status for', url.substring(0, 50) + '...', ':', res.statusCode);
  });
  req.write(payload);
  req.end();
});

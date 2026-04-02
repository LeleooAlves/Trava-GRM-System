const fs = require('fs');
const https = require('https');

const imgBuffer = fs.readFileSync('logo.png');
const base64Img = imgBuffer.toString('base64');
const dataUri = `data:image/png;base64,${base64Img}`;

const payload = JSON.stringify({
  name: "Atualizações de projeto",
  avatar: dataUri
});

const req = https.request('https://discord.com/api/webhooks/1489314500409561129/Wd4dosg-R_n7Fb1AnE974VDk8s-qmz891SN9FArpNgQnaZ06HYX2AU8Stj-wqEJSYhYV', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  console.log('Status:', res.statusCode);
});
req.write(payload);
req.end();

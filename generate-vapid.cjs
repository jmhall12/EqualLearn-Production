
const crypto = require("node:crypto");

const ecdh = crypto.createECDH("prime256v1");
ecdh.generateKeys();

function toBase64Url(buffer) {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

const publicKey = toBase64Url(ecdh.getPublicKey());
const privateKey = toBase64Url(ecdh.getPrivateKey());

console.log("\n========== EQUALLEARN VAPID KEYS ==========\n");
console.log("PUBLIC KEY:\n" + publicKey);
console.log("\nPRIVATE KEY:\n" + privateKey);
console.log("\n===========================================\n");
console.log("Keep your PRIVATE KEY secret!");


const crypto = require("node:crypto");

const publicKey = "BHDWCl52z3KypptauLy3msuE3KWXkaD9-Bv3WQGAp9S17MiZhC0RbuQTzMmXQYrEpGAmCZsNLI10FpuUAc9PW3I";
const privateKey = "FXJHPUaqMfQlLt8fXZdvC2h6n0vdCUHpNZLc3uuBP20";

const decode = value =>
  Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  );

try {
  const pub = decode(publicKey);
  const priv = decode(privateKey);

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(priv);

  const derivedPublic = ecdh.getPublicKey();

  console.log("Public key length:", pub.length);
  console.log("Private key length:", priv.length);
  console.log(
    "Keys match:",
    pub.equals(derivedPublic)
  );
} catch (error) {
  console.error("Verification failed:", error.message);
}

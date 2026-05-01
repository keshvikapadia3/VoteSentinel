const crypto = require("crypto");

const algorithm = "aes-256-cbc";

const key = crypto
  .createHash("sha256")
  .update(process.env.VOTE_SECRET_KEY)
  .digest();

function encrypt(text) {

  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(
    algorithm,
    key,
    iv
  );

  let encrypted = cipher.update(
    text,
    "utf8",
    "hex"
  );

  encrypted += cipher.final("hex");

  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text) {

  const parts = text.split(":");

  const iv = Buffer.from(parts[0], "hex");

  const encryptedText = parts[1];

  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    iv
  );

  let decrypted = decipher.update(
    encryptedText,
    "hex",
    "utf8"
  );

  decrypted += decipher.final("utf8");

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};
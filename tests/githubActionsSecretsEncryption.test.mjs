import assert from "node:assert/strict";
import test from "node:test";
import sodium from "libsodium-wrappers";

async function encryptGitHubSecretLikeProduction(publicKey, secretValue) {
  await sodium.ready;
  const publicKeyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(secretValue);
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, publicKeyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

test("encryptGitHubSecret sealed-box flow returns non-empty base64 that is not the plain secret", async () => {
  await sodium.ready;
  const keyPair = sodium.crypto_box_keypair();
  const publicKey = sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL);
  const plainSecret = "shopling-login-secret";

  const encrypted = await encryptGitHubSecretLikeProduction(publicKey, plainSecret);

  assert.match(encrypted, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.notEqual(encrypted, "");
  assert.notEqual(encrypted, plainSecret);
  assert.doesNotMatch(encrypted, new RegExp(plainSecret));
});

test("sealed-box encryption works with a generated sodium keypair public key", async () => {
  await sodium.ready;
  const keyPair = sodium.crypto_box_keypair();
  const publicKey = sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL);
  const plainSecret = "api-auth-key-value";

  const encrypted = await encryptGitHubSecretLikeProduction(publicKey, plainSecret);
  const opened = sodium.crypto_box_seal_open(
    sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL),
    keyPair.publicKey,
    keyPair.privateKey,
  );

  assert.equal(sodium.to_string(opened), plainSecret);
});

test("sealed-box encryption fails safely on an invalid public key", async () => {
  await assert.rejects(
    () => encryptGitHubSecretLikeProduction("not-a-valid-public-key", "secret-value"),
    /invalid|incomplete|input|length|base64/i,
  );
});

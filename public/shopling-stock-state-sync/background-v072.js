importScripts("background-v071.js");

// HF30 release marker. The inherited HF28 coordinator and HF29 OPTION batching
// activate their v0.5.8 capability gates from the packaged manifest version:
// OPTION may lead Lane 1, detach happens only after the final OPTION batch is
// submitted, and each A21 batch contains at most 200 exact Shopling goods keys.
console.log(
  "[CommerceOS Stock HF30]",
  new Date().toISOString(),
  "B-code atomic OPTION flow · final-batch detach · A21 max 200",
);

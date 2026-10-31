-- Airnode-attested verification.
--
-- A verification observation answered by an Airnode carries a signature over the exact
-- response it gave. `evm_attestation` keeps the whole attestation, including the signed
-- body, so the evidence can be re-verified later by anyone. `evm_attested_by` is the signer,
-- set only when the worker re-checked the signature and the request it answers.

alter table api_events
  add column if not exists evm_attestation jsonb,
  add column if not exists evm_attested_by text;

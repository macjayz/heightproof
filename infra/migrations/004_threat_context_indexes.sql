-- Indexes for the per-event threat context queries.
--
-- The worker runs these for every evm_rpc event, so each must read only its time window, not
-- the provider's or wallet's whole history.

-- Provider latency and failure rate (provider_degradation, D5).
create index if not exists api_events_evm_provider_idx
  on api_events(project_id, evm_provider, timestamp desc)
  where kind = 'evm_rpc';

-- Wallet transaction rate (wallet_tx_spike).
create index if not exists api_events_evm_wallet_idx
  on api_events(project_id, wallet_address, timestamp desc)
  where kind = 'evm_rpc' and wallet_address is not null;

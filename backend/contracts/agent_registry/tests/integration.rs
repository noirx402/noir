#[cfg(test)]
mod tests {
    use agent_registry::{AgentRegistry, AgentRegistryClient};
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::{
        contract, contracterror, contractimpl, panic_with_error, Address, BytesN, Env,
    };

    /// Stand-in for device_registry: only `get_owner` is called by
    /// agent_registry. Unknown devices fail like the real DeviceNotFound.
    #[contract]
    pub struct MockDevices;

    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum MockError {
        DeviceNotFound = 2,
    }

    #[contractimpl]
    impl MockDevices {
        pub fn set_owner(env: Env, device_hash: BytesN<32>, owner: Address) {
            env.storage().persistent().set(&device_hash, &owner);
        }

        pub fn get_owner(env: Env, device_hash: BytesN<32>) -> Address {
            env.storage()
                .persistent()
                .get(&device_hash)
                .unwrap_or_else(|| panic_with_error!(&env, MockError::DeviceNotFound))
        }
    }

    /// Record `wallet` as the owner of `device_hash` in the mock registry.
    fn own(env: &Env, devices: &Address, wallet: &Address, device_hash: &BytesN<32>) {
        MockDevicesClient::new(env, devices).set_owner(device_hash, wallet);
    }

    fn random_address(env: &Env) -> Address {
        <Address as soroban_sdk::testutils::Address>::generate(env)
    }

    fn random_bytes_32(env: &Env) -> BytesN<32> {
        <BytesN<32> as soroban_sdk::testutils::BytesN<32>>::random(env)
    }

    /// Deploy an initialized registry wired to a mock device registry; returns
    /// the client and the mock's address.
    fn deploy(env: &Env) -> (AgentRegistryClient<'_>, Address) {
        let devices = env.register(MockDevices, ());
        let contract_id = env.register(AgentRegistry, ());
        let client = AgentRegistryClient::new(env, &contract_id);
        let admin = random_address(env);
        client.initialize(&admin, &devices);
        (client, devices)
    }

    #[test]
    fn test_initialize_happy_path() {
        let env = Env::default();
        env.mock_all_auths();
        deploy(&env);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_initialize_double_init_guard() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env);
        client.initialize(&random_address(&env), &random_address(&env));
    }

    #[test]
    fn test_register_and_get_agent_roundtrip() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        // max_amount = 1000, never expires.
        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);

        assert_eq!(client.get_agent(&device_hash), agent);

        let policy = client.get_policy(&device_hash);
        assert_eq!(policy.agent, agent);
        assert_eq!(policy.max_amount, 1000);
        assert_eq!(policy.asset, asset);
        assert_eq!(policy.expires_at, 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_duplicate_registration_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_register_with_past_expiry_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        // expires_at (500) already in the past relative to ledger time (1000).
        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_register_with_negative_max_amount_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &-1, &asset, &0);
    }

    #[test]
    fn test_is_auth_true_for_authorized_agent() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
        assert!(client.is_auth(&device_hash, &agent));
    }

    #[test]
    fn test_is_auth_false_for_stranger() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let stranger = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
        assert!(!client.is_auth(&device_hash, &stranger));
    }

    #[test]
    fn test_is_auth_false_after_expiry() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        // Expires at 2000.
        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &2000);
        assert!(client.is_auth(&device_hash, &agent));

        // Advance past expiry.
        env.ledger().set_timestamp(2001);
        assert!(!client.is_auth(&device_hash, &agent));
    }

    #[test]
    fn test_revoke_removes_authorization() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
        client.revoke_agent(&wallet, &device_hash);
        assert!(!client.is_auth(&device_hash, &agent));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_revoke_unknown_device_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env);
        let wallet = random_address(&env);
        client.revoke_agent(&wallet, &random_bytes_32(&env));
    }

    // ---- check_payment: the single enforcement predicate ----

    #[test]
    fn test_check_payment_accepts_in_policy() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
        assert!(client.check_payment(&device_hash, &agent, &asset, &500));
        assert!(client.check_payment(&device_hash, &agent, &asset, &1000)); // at the cap
    }

    #[test]
    fn test_check_payment_rejects_over_limit() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
        assert!(!client.check_payment(&device_hash, &agent, &asset, &1001));
    }

    #[test]
    fn test_check_payment_rejects_wrong_asset() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let other_asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
        assert!(!client.check_payment(&device_hash, &agent, &other_asset, &500));
    }

    #[test]
    fn test_check_payment_rejects_nonpositive_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &0);
        assert!(!client.check_payment(&device_hash, &agent, &asset, &0));
        assert!(!client.check_payment(&device_hash, &agent, &asset, &-5));
    }

    #[test]
    fn test_check_payment_uncapped_when_max_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        // max_amount 0 = uncapped.
        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &0, &asset, &0);
        assert!(client.check_payment(&device_hash, &agent, &asset, &i128::MAX));
    }

    #[test]
    fn test_check_payment_rejects_after_expiry() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (client, devices) = deploy(&env);

        let wallet = random_address(&env);
        let agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &agent, &1000, &asset, &2000);
        assert!(client.check_payment(&device_hash, &agent, &asset, &500));

        env.ledger().set_timestamp(2001);
        assert!(!client.check_payment(&device_hash, &agent, &asset, &500));
    }

    // ---- ownership (Week 4 audit) ----

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_register_for_unowned_device_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env);
        let wallet = random_address(&env);
        client.register_agent(
            &wallet, &random_bytes_32(&env), &random_address(&env), &0, &random_address(&env), &0,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_register_for_someone_elses_device_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);
        let owner = random_address(&env);
        let attacker = random_address(&env);
        let device_hash = random_bytes_32(&env);
        own(&env, &devices, &owner, &device_hash);
        client.register_agent(&attacker, &device_hash, &attacker, &0, &random_address(&env), &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_revoke_by_stranger_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);
        let wallet = random_address(&env);
        let device_hash = random_bytes_32(&env);
        own(&env, &devices, &wallet, &device_hash);
        client.register_agent(&wallet, &device_hash, &random_address(&env), &0, &random_address(&env), &0);
        client.revoke_agent(&random_address(&env), &device_hash);
    }

    #[test]
    fn test_new_owner_replaces_stale_policy() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, devices) = deploy(&env);
        let old_owner = random_address(&env);
        let new_owner = random_address(&env);
        let new_agent = random_address(&env);
        let asset = random_address(&env);
        let device_hash = random_bytes_32(&env);

        own(&env, &devices, &old_owner, &device_hash);
        client.register_agent(&old_owner, &device_hash, &random_address(&env), &0, &asset, &0);

        // Tag changes hands (device revoked + re-registered by someone else).
        own(&env, &devices, &new_owner, &device_hash);
        client.register_agent(&new_owner, &device_hash, &new_agent, &50, &asset, &0);

        let policy = client.get_policy(&device_hash);
        assert_eq!(policy.owner, new_owner);
        assert_eq!(policy.agent, new_agent);
        assert_eq!(policy.max_amount, 50);
    }
}

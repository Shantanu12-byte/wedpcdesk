import { auth } from './auth';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

console.log('Running auth.isLocalAddress unit tests...');

// 1. IPv4 Loopback
assert(auth.isLocalAddress('127.0.0.1') === true, '127.0.0.1 should be local');

// 2. IPv6 Loopback
assert(auth.isLocalAddress('::1') === true, '::1 should be local');

// 3. Hostname local bypass
assert(auth.isLocalAddress('localhost') === true, 'localhost should be local');

// 4. IPv4-mapped IPv6 Loopback
assert(auth.isLocalAddress('::ffff:127.0.0.1') === true, '::ffff:127.0.0.1 should be local');
assert(auth.isLocalAddress('::ffff:127.0.0.8') === true, '::ffff:127.0.0.8 should be local');

// 5. External LAN IP (should be false, requiring token)
assert(auth.isLocalAddress('192.168.1.100') === false, 'LAN IP 192.168.1.100 should not be local');
assert(auth.isLocalAddress('10.0.0.5') === false, 'LAN IP 10.0.0.5 should not be local');

// 6. Public IP (should be false)
assert(auth.isLocalAddress('8.8.8.8') === false, 'Public IP 8.8.8.8 should not be local');

// 7. Undefined or empty cases
assert(auth.isLocalAddress(undefined) === false, 'Undefined IP should not be local');
assert(auth.isLocalAddress('') === false, 'Empty IP should not be local');

console.log('\nAll auth unit tests passed successfully!');

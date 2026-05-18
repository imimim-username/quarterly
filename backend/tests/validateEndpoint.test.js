'use strict';

const dns = require('dns');
const { validateUrl } = require('../src/middleware/validateEndpoint');

// Save original dns.promises.lookup
const originalLookup = dns.promises.lookup;

afterEach(() => {
  // Restore original lookup after each test
  dns.promises.lookup = originalLookup;
});

describe('validateEndpoint — validateUrl()', () => {
  // --- Loopback (http allowed) ---
  test('http loopback 127.0.0.1 is allowed', async () => {
    const result = await validateUrl('http://127.0.0.1:8080/graphql');
    expect(result).toBeNull();
  });

  test('http loopback localhost is allowed', async () => {
    const result = await validateUrl('http://localhost:4000/graphql');
    expect(result).toBeNull();
  });

  test('http private (192.168.x.x) is rejected', async () => {
    const result = await validateUrl('http://192.168.1.1/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/loopback/i);
  });

  // --- HTTPS public allowed ---
  test('https public IP is allowed', async () => {
    // Mock DNS to avoid real network call — use a clearly public IP
    dns.promises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const result = await validateUrl('https://example.com/graphql');
    expect(result).toBeNull();
  });

  // --- HTTPS private rejected ---
  test('https with private IP 10.0.0.1 is rejected', async () => {
    const result = await validateUrl('https://10.0.0.1/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/private/i);
  });

  test('https with private IP 172.16.0.1 is rejected', async () => {
    const result = await validateUrl('https://172.16.0.1/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/private/i);
  });

  test('https with private IP 192.168.1.100 is rejected', async () => {
    const result = await validateUrl('https://192.168.1.100/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/private/i);
  });

  test('https with loopback IP 127.0.0.1 is rejected', async () => {
    const result = await validateUrl('https://127.0.0.1/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/private|reserved/i);
  });

  // --- Bad scheme ---
  test('ftp scheme is rejected', async () => {
    const result = await validateUrl('ftp://example.com/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/scheme|not allowed/i);
  });

  test('file scheme is rejected', async () => {
    const result = await validateUrl('file:///etc/passwd');
    expect(result).not.toBeNull();
  });

  // --- Credentials ---
  test('URL with credentials is rejected', async () => {
    const result = await validateUrl('https://user:pass@example.com/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/credentials/i);
  });

  // --- Blocked ports ---
  test('port 22 (SSH) is blocked', async () => {
    const result = await validateUrl('https://example.com:22/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/port 22 is blocked/i);
  });

  test('port 25 (SMTP) is blocked', async () => {
    const result = await validateUrl('https://example.com:25/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/port 25 is blocked/i);
  });

  test('port 465 is blocked', async () => {
    const result = await validateUrl('https://example.com:465/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/port 465 is blocked/i);
  });

  test('port 587 is blocked', async () => {
    const result = await validateUrl('https://example.com:587/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/port 587 is blocked/i);
  });

  // --- Parse failure ---
  test('totally invalid URL is rejected', async () => {
    const result = await validateUrl('not a url at all');
    expect(result).not.toBeNull();
    expect(result).toMatch(/invalid url/i);
  });

  // --- DNS rebinding: mock returns private IP ---
  test('DNS rebinding: hostname resolves to private IP is rejected', async () => {
    dns.promises.lookup = async () => [{ address: '192.168.1.1', family: 4 }];
    const result = await validateUrl('https://evil-rebinding.example.com/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/private|reserved/i);
  });

  test('DNS rebinding: hostname resolves to loopback IP is rejected', async () => {
    dns.promises.lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    const result = await validateUrl('https://localhost-rebind.example.com/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/private|reserved/i);
  });

  // --- Dual-stack: one public + one private → rejected ---
  test('dual-stack: public + private address → rejected', async () => {
    dns.promises.lookup = async () => [
      { address: '93.184.216.34', family: 4 },  // public
      { address: '10.0.0.1', family: 4 },        // private
    ];
    const result = await validateUrl('https://dual-stack.example.com/graphql');
    expect(result).not.toBeNull();
    expect(result).toMatch(/private|reserved/i);
  });
});

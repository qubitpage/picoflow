"""Verify Arc deployments on-chain via Alchemy."""
import requests, json, sys

RPC = 'https://arc-testnet.g.alchemy.com/v2/Ljy_yjqBi70q-hWcAQgVM'
addrs = {
    'BondVault':          '0x00792829C3553B95A84bafe33c76E93570D0AbA4',
    'ReputationRegistry': '0x8Cf86bA01806452B336369D4a25466c34951A086',
    'MetadataLogger':     '0x2853EDc8BAa06e7A7422CCda307ED3E7f0E96FA8',
}
DEPLOYER = '0x5257613C0a0b87405d08B21c62Be3F65CbD0a5bF'

def rpc(method, params):
    r = requests.post(RPC, json={'jsonrpc':'2.0','id':1,'method':method,'params':params}, timeout=15)
    j = r.json()
    if 'error' in j:
        return f'ERR {j["error"]}'
    return j.get('result')

cid = rpc('eth_chainId', [])
bn  = rpc('eth_blockNumber', [])
print(f'chainId         = {int(cid,16) if isinstance(cid,str) and cid.startswith("0x") else cid}')
print(f'blockNumber     = {int(bn,16)  if isinstance(bn,str)  and bn.startswith("0x")  else bn}')

bal = rpc('eth_getBalance', [DEPLOYER, 'latest'])
nonce_p = rpc('eth_getTransactionCount', [DEPLOYER, 'pending'])
nonce_l = rpc('eth_getTransactionCount', [DEPLOYER, 'latest'])
def hex2int(x): return int(x,16) if isinstance(x,str) and x.startswith('0x') else x
bal_wei = hex2int(bal); np = hex2int(nonce_p); nl = hex2int(nonce_l)
print(f'deployer        = {DEPLOYER}')
print(f'balance         = {bal_wei} wei  ({bal_wei/1e18:.6f} ETH)')
print(f'nonce latest    = {nl}')
print(f'nonce pending   = {np}   stuck_diff={np-nl if isinstance(np,int) and isinstance(nl,int) else "?"}')
print()
ok = 0
for name, a in addrs.items():
    code = rpc('eth_getCode', [a, 'latest'])
    on_chain = isinstance(code, str) and code != '0x' and len(code) > 4
    if on_chain: ok += 1
    print(f'  {name:20} {a}  code_bytes={(len(code)-2)//2 if isinstance(code,str) else "?"}  on_chain={on_chain}')

print()
print(f'SUMMARY: {ok}/{len(addrs)} contracts live on Arc testnet via Alchemy')
sys.exit(0 if ok == len(addrs) else 1)

const isLive = false;

window.addEventListener('DOMContentLoaded', async () => {
  let accounts;
  const onboarding = new MetaMaskOnboarding();
  const mintButton = document.getElementById('mintButton');

  if (!MetaMaskOnboarding.isMetaMaskInstalled()) {
    onboarding.startOnboarding();
  } else if (accounts && accounts.length > 0) {
    onboarding.stopOnboarding();
  }
  await switchNetwork();
  await getMMAccount();
  await updateMintStatus();

  mintButton.onclick = async () => {
    await _mint();
  };

  ethereum.on('accountsChanged', function (accounts) {
    window.location.href = '';
  })
});

async function _mint() {
  try {
    await mintVitalik();
  } catch(e) {
    // console.log(e)
    if (e.message) {
      alert(e.message);
    } else {
      alert(e.toString());
    }
    document.getElementById('mintForm').classList.remove('hidden');
    document.getElementById('loading').classList.add('hidden');
    await updateMintStatus();
    return false;
  }
}

async function getMMAccount() {
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });
    const account = accounts[0];
    return account;
  } catch(e) {
    updateMintMessage(`Something went wrong. Refresh and try again.`);
  }
}

function updateMintMessage(reason) {
  document.getElementById('mintMessage').innerHTML = reason;
}

async function getDistribution() {
  let distr;
  let account = await getMMAccount();
  return await fetch('/distribution.json')
    .then((res) => res.json())
    .then(data => {
      for(addr in data) {
        if (addr.toLowerCase() == account.toLowerCase()) {
          distr = data[addr];
          console.log(`Found details for address ${addr}: ${JSON.stringify(distr)}`);
        }
      }
      return distr;
    });
}

async function switchNetwork(){
  let chainId;
  if (!isLive) {
    chainId = '0x4';
  } else {
    chainId = '0x1';
  }
  await ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: chainId }],
  });
}

async function updateMintStatus() {
  const w3 = new Web3(Web3.givenProvider || "http://127.0.0.1:7545");
  const walletAddress = await getMMAccount();
  const walletShort = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4)
  const contract = new w3.eth.Contract(contractABI, contractAddress, {from: walletAddress});
  const earlyAccessMode = await contract.methods.earlyAccessMode().call();
  const salePrice = await contract.methods.salePrice().call();
  const currentSupply = await contract.methods.totalSupply().call();
  const maxSupply = await contract.methods.maxSupply().call();
  const balance = await contract.methods.balanceOf(walletAddress).call();
  const salePriceEth = w3.utils.fromWei(salePrice);
  const mintingIsActive = await contract.methods.mintingIsActive().call();
  const dist = await getDistribution();
  if (!mintingIsActive) {
    updateMintMessage(`Minting is not active yet! Check back later. ${currentSupply} / ${maxSupply} minted.`);
    return false;
  }
  if (dist && earlyAccessMode) {
    let remaining = dist.Amount - balance;
    if (remaining < 0) {
      remaining = 0;
    }
    updateMintMessage(`Wallet ${walletShort} is whitelisted for ${remaining} more Vitaliks (${dist.Amount} whitelisted, ${balance} minted). </br><div style="margin-top: 8px"></div><h2><b>${currentSupply} / ${maxSupply} minted</b></h2><div style="margin-top: 8px"></div><h3><b>${salePriceEth} Ξ</b></h3>`);
    if (remaining == 0) {
      document.getElementById('mintForm').classList.add('hidden');
      return false;
    }
    document.getElementById('numberOfTokens').max = 25;
    document.getElementById('numberOfTokens').value = remaining;
    document.getElementById('mintForm').classList.remove('hidden');
  } else if (!dist && earlyAccessMode) {
    updateMintMessage(`Wallet ${walletShort} is not whitelisted. Check back during public minting.`);
  } else if (!earlyAccessMode) {
    updateMintMessage(`Public minting is live! Limit 5 per transaction.</br><div style="margin-top: 8px"></div><h2><b>${currentSupply} / ${maxSupply} minted</b></h2><div style="margin-top: 8px"></div><h3><b>${salePriceEth} Ξ</b></h3>`);
    document.getElementById('mintForm').classList.remove('hidden');
  }
}

async function mintVitalik() {
  let etherscan_uri = 'etherscan.io';
  let opensea_uri = 'opensea.io';
  // First do nothing if MetaMask is on Mainnet and we're not live yet
  if (!isLive) {
    if (window.ethereum.chainId == "0x1") {
      updateMintMessage(`Mainnet contracts not available yet. Try again later.`);
      return false;
    }
    etherscan_uri = 'rinkeby.etherscan.io';
    opensea_uri = 'testnets.opensea.io';
  }

  let res;
  let loadModal;
  let gasLimit;
  const w3 = new Web3(Web3.givenProvider || "http://127.0.0.1:7545");
  const walletAddress = await getMMAccount();
  const gasPrice = await w3.eth.getGasPrice();
  let amountToMint = document.getElementById('numberOfTokens').value;
  if (amountToMint <= 0 || amountToMint > 20 || isNaN(amountToMint)) {
    amountToMint = 1;
    document.getElementById('numberOfTokens').value = amountToMint;
  }

  // Define the contract we want to use
  const contract = new w3.eth.Contract(contractABI, contractAddress, {from: walletAddress});

  // Check if we're in earlyAccessMode to do more checks
  const earlyAccessMode = await contract.methods.earlyAccessMode().call();

  // Grab sale price
  const salePrice = await contract.methods.salePrice().call();

  // Fail if sales are paused
  const mintingIsActive = await contract.methods.mintingIsActive().call();
  if (!mintingIsActive) {
    updateMintMessage(`Sales are currently paused on this contract. Try again later.`);
    return false;
  }

  // Fail if requested amount would exceed supply
  let currentSupply = await contract.methods.totalSupply().call();
  let maxSupply = await contract.methods.maxSupply().call();
  if (Number(currentSupply) + Number(amountToMint) > Number(maxSupply)) {
    updateMintMessage(`Requesting ${amountToMint} would exceed the maximum token supply of ${maxSupply}. Current supply is ${currentSupply}, so try minting ${maxSupply - currentSupply}.`)
    return false;
  }

  if (earlyAccessMode) {

    // Get the merkle tree distribution info for the user
    const dist = await getDistribution();
    if (!dist) {
      updateMintMessage(`Minting is currently only for holders of Non-Fungible Soup NFTs. Your wallet address is not on the whitelist. Come back when public minting has started.`);
      return false;
    }

    // Fail if the merkle root hash is not set
    const merkleSet = await contract.methods.merkleSet().call();
    if (!merkleSet) {
      updateMintMessage(`Admin has not setup the contract properly yet: No merkle root hash is set`);
      return false;
    }

    // Fail if the amountToMint is more than allowed
    const balance = await contract.methods.balanceOf(walletAddress).call();
    if (Number(Number(amountToMint) + Number(balance)) > Number(dist.Amount)) {
      updateMintMessage(`Cannot mint more than your whitelisted amount of ${dist.Amount}. You already have ${balance}.`);
      return false;
    }

    // Estimate gas limit
    await contract.methods.mintVitaliks(dist.Index, walletAddress, Number(dist.Amount), dist.Proof, amountToMint).estimateGas({from: walletAddress, value: salePrice * amountToMint}, function(err, gas){
      gasLimit = gas;
    });

    // Show loading icon
    document.getElementById('mintForm').classList.add('hidden');
    document.getElementById('loading').classList.remove('hidden');
    updateMintMessage('');

    // Attempt minting
    console.log(`Attempting to mint ${amountToMint} tokens with gas limit of ${gasLimit} gas and gas price of ${gasPrice}`);
    res = await contract.methods.mintVitaliks(dist.Index, walletAddress, Number(dist.Amount), dist.Proof, amountToMint).send({
      from: walletAddress,
      value: salePrice * amountToMint,
      gasPrice: gasPrice,
      gas: gasLimit
    });
    console.log(res);
  } else {
    // Estimate gas limit
    await contract.methods.mintVitaliks(0, walletAddress, 0, [], amountToMint).estimateGas({from: walletAddress, value: salePrice * amountToMint}, function(err, gas){
      gasLimit = gas;
    });

    // Show loading icon
    document.getElementById('mintForm').classList.add('hidden');
    document.getElementById('loading').classList.remove('hidden');
    updateMintMessage('');

    // If not in earlyAccessMode, we can just use empty amounts in func
    console.log(`Attempting to mint ${amountToMint}`);
    res = await contract.methods.mintVitaliks(0, walletAddress, 0, [], amountToMint).send({
      from: walletAddress,
      value: salePrice * amountToMint,
      gasPrice: gasPrice,
      gas: gasLimit
    });
    console.log(res);
  }

  document.getElementById('mintForm').classList.remove('hidden');
  document.getElementById('loading').classList.add('hidden');

  if (res.status) {
    updateMintMessage(`Success! Head to <a href="https://${opensea_uri}/account?search[resultModel]=ASSETS&search[sortBy]=LAST_TRANSFER_DATE&search[sortAscending]=false">OpenSea</a> to see your NFTs!`);
    document.getElementById('mintForm').innerHTML = `<a href="https://${etherscan_uri}/tx/${res.transactionHash}">Etherscan</a>`;
  } else {
    updateMintMessage('FAILED!');
    document.getElementById('mintForm').innerHTML = `<a href="">Try Again</a>`;
  }
}

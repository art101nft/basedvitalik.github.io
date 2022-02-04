const isLive = false;

window.addEventListener('DOMContentLoaded', () => {
  const onboarding = new MetaMaskOnboarding();
  const connectButtons = document.getElementsByClassName('ConnectMM');
  const mintButtons = document.getElementsByClassName('mintZine');
  const infoButtons = document.getElementsByClassName('getMintInfo');
  let accounts;
  // Setup click triggers to onboard MetaMask
  for(i = 0; i < connectButtons.length; i++) {
    connectButtons[i].onclick = async () => {
      if (!MetaMaskOnboarding.isMetaMaskInstalled()) {
        onboarding.startOnboarding();
      } else if (accounts && accounts.length > 0) {
        onboarding.stopOnboarding();
      }

      await getMMAccount();
    };
  }
  // Setup click triggers to mint
  for(i = 0; i < mintButtons.length; i++) {
    mintButtons[i].onclick = async () => {
      await doit();
    };
  }
  // Setup click triggers for mint info
  for(i = 0; i < infoButtons.length; i++) {
    infoButtons[i].onclick = async () => {
      await getMintInfo();
    };
  }
});

async function doit() {
  try {
    await mintZine();
  } catch(e) {
    if (e.message) {
      loadFailedModal(e.message);
    } else {
      loadFailedModal(`Failed to mint! Check Javascript console logs for more detail and reach out on Discord for help. Error: ${e.toString()}`);
    }
    console.log(e.toString());
    console.log(e);
    return false;
  }
}

async function getMMAccount() {
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });
    const account = accounts[0];
    return account
  } catch(e) {
    $('#NFTZineModalMint').modal('hide');
    loadFailedModal(`Something went wrong. Refresh and try again.`)
  }
}

function loadFailedModal(reason) {
  setTimeout(function() {
    $('#NFTZineModalMinting').modal('hide');
    document.getElementById('failText').innerHTML = reason;
    $('#NFTZineModalFailed').modal('show');
  }, 1000);
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

async function mintZine() {
  // First do nothing if MetaMask is on Mainnet and we're not live yet
  if (!isLive) {
    if (window.ethereum.chainId == "0x1") {
      loadFailedModal(`Mainnet contracts not available yet. Try again later.`);
      return false;
    }
  }

  let res;
  let loadModal;
  let gasLimit;
  const w3 = new Web3(Web3.givenProvider || "http://127.0.0.1:7545");
  const walletAddress = await getMMAccount();
  const gasPrice = await w3.eth.getGasPrice();
  let amountToMint = document.getElementById('numberOfTokens').value;
  if (amountToMint <= 0 || amountToMint > 2 || isNaN(amountToMint)) {
    amountToMint = 1;
  }

  $('#NFTZineModalMinting').modal('show');

  // Define the contract we want to use
  const contract = new w3.eth.Contract(contractABI, contractAddress, {from: walletAddress});

  // Check if we're in earlyAccessMode to do more checks
  const earlyAccessMode = await contract.methods.earlyAccessMode().call();

  // Fail if sales are paused
  const mintingIsActive = await contract.methods.mintingIsActive().call();
  if (!mintingIsActive) {
    loadFailedModal(`Sales are currently paused on this contract. Try again later.`);
    return false;
  }

  // Fail if requested amount is more than max
  let balance = await contract.methods.balanceOf(walletAddress).call();
  let maxAmount = await contract.methods.maxMints().call();
  if (Number(balance) + Number(amountToMint) > maxAmount) {
    loadFailedModal(`Requesting ${amountToMint} would put you over the maximum amount of 2 per address since you currently have a balance of ${balance} NFTZines.`)
    return false;
  }

  // Fail if requested amount would exceed supply
  let currentSupply = await contract.methods.tokensMinted().call();
  let maxSupply = await contract.methods.maxSupply().call();
  if (Number(currentSupply) + Number(amountToMint) > Number(maxSupply)) {
    loadFailedModal(`Requesting ${amountToMint} would exceed the maximum token supply of ${maxSupply}. Current supply is ${currentSupply}, so try minting ${maxSupply - currentSupply}.`)
    return false;
  }

  if (earlyAccessMode) {

    // Get the merkle tree distribution info for the user
    const dist = await getDistribution();
    if (!dist) {
      loadFailedModal(`Minting is currently only for holders of Art101 NFTs and/or users of Patrn.me. Your wallet address is not on the whitelist. Come back when public minting has started.`);
      return false;
    }

    // Fail if the merkle root hash is not set
    const merkleSet = await contract.methods.isMerkleSet().call();
    if (!merkleSet) {
      loadFailedModal(`Admin has not setup the contract properly yet: No merkle root hash is set`);
      return false;
    }

    // Fail if randPrime is not set yet
    const randPrime = await contract.methods.randPrime().call();
    if (randPrime == 0) {
      loadFailedModal(`Admin has not setup the contract properly yet: No random prime number set`);
      return false;
    }

    // Estimate gas limit
    await contract.methods.mintZines(dist.Index, walletAddress, Number(dist.Amount), dist.Proof, amountToMint).estimateGas(function(err, gas){
      gasLimit = gas;
    });

    // Attempt minting for
    console.log(`Attempting to mint ${amountToMint} tokens with gas limit of ${gasLimit} gas and gas price of ${gasPrice}`);
    res = await contract.methods.mintZines(dist.Index, walletAddress, Number(dist.Amount), dist.Proof, amountToMint).send({
      from: walletAddress,
      value: 0,
      gasPrice: gasPrice,
      gas: gasLimit
    });
    console.log(res);
  } else {
    // If not in earlyAccessMode, we can just use empty amounts in func
    console.log(`Attempting to mint ${amountToMint}`);
    res = await contract.methods.mintZines(0, walletAddress, 0, [], amountToMint).send({
      from: walletAddress,
      value: 0,
      gasPrice: gasPrice,
      gas: gasLimit * amountToMint
    });
    console.log(res);
  }

  if (res.status) {
    loadModal = '#NFTZineModalSuccess';
  } else {
    loadModal = '#NFTZineModalFailed';
  }
  $('#NFTZineModalMinting').modal('hide');
  $(loadModal).modal('show');
}

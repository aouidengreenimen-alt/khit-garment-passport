// Deploys GarmentPassport and saves its address and ABI to deployments/<network>.json
//
//   Local test run:   npx hardhat run scripts/deploy.js
//   Hedera testnet:   npx hardhat run scripts/deploy.js --network hederaTestnet

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const network = hre.network.name;

  if (network === "hederaTestnet" && !(process.env.AGENT_PRIVATE_KEY || "").trim()) {
    throw new Error(
      "AGENT_PRIVATE_KEY is empty. Copy .env.example to .env and paste the agent account's private key."
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Network   ${network}`);
  console.log(`Deployer  ${deployer.address}  (balance ${hre.ethers.formatEther(balance)})`);
  console.log("Deploying...");

  const Passport = await hre.ethers.getContractFactory("GarmentPassport");
  const passport = await Passport.deploy();
  await passport.waitForDeployment();

  const address = await passport.getAddress();
  const { chainId } = await hre.ethers.provider.getNetwork();
  const artifact = await hre.artifacts.readArtifact("GarmentPassport");

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        network,
        chainId: Number(chainId),
        address,
        owner: deployer.address,
        deployTx: passport.deploymentTransaction()?.hash ?? null,
        deployedAt: new Date().toISOString(),
        abi: artifact.abi,
      },
      null,
      2
    ) + "\n"
  );

  // Demo data belongs to one contract. A new contract starts without any.
  const demoFile = path.join(outDir, `${network}.demo.json`);
  if (fs.existsSync(demoFile)) fs.unlinkSync(demoFile);

  console.log(`\nGarmentPassport deployed at ${address}`);
  if (Number(chainId) === 296) {
    console.log(`See it on HashScan: https://hashscan.io/testnet/contract/${address}`);
  }
  console.log(`Saved to ${path.relative(process.cwd(), outFile)}`);
  console.log(`The deployer owns the contract and approves the companies.`);
  console.log(`Next, for demo data:  npm run seed`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

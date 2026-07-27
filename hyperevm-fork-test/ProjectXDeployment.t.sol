// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    IHyperSwapV3Factory,
    IHyperSwapV3Pool,
    IHyperSwapV3PositionManager,
    IHyperSwapV3Router
} from "../src/hyperevm/interfaces/IHyperSwapV3.sol";
import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {FWATokenHyperEVMFactory} from "../src/hyperevm/FWATokenHyperEVMFactory.sol";
import {HWAProjectXLiquidityLocker} from "../src/hyperevm/HWAProjectXLiquidityLocker.sol";
import {ISafe, ISafeProxyFactory} from "../src/hyperevm/interfaces/ISafe.sol";
import {TestBase} from "../test/utils/TestBase.sol";

/// @notice Mainnet-fork compatibility proof against the deployed Project X V3 stack.
/// @dev This test never broadcasts and creates only ephemeral contracts inside the local fork.
contract ProjectXDeploymentTest is TestBase {
    address internal constant FACTORY = 0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072;
    address internal constant ROUTER = 0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B;
    address internal constant NFPM = 0xeaD19AE861c29bBb2101E834922B2FEee69B9091;
    address internal constant WHYPE = 0x5555555555555555555555555555555555555555;
    address internal constant USER = address(0xB0B);
    address internal constant SAFE_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address internal constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant SAFE_FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    address internal constant SAFE_SIGNER_1 = 0x645b7e2A32cfF5e131a3D6Cf16155e006fe74F5c;
    address internal constant SAFE_SIGNER_2 = 0x487F29A5C4eE0669D40d77Cd78F5b6A95046fECB;
    address internal constant SAFE_SIGNER_3 = 0x10B327d693F223399F2D8151B2B97a66818FF681;
    address internal constant EXPECTED_SAFE = 0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C;
    uint256 internal constant SAFE_SALT_NONCE = uint256(keccak256("HWA_SAFE_HYPEREVM_MAINNET_V1"));

    function testProjectXMainnetContractsExposeExpectedV3Wiring() public view {
        assertEq(block.chainid, 999);
        assertTrue(FACTORY.code.length != 0);
        assertTrue(ROUTER.code.length != 0);
        assertTrue(NFPM.code.length != 0);
        assertTrue(WHYPE.code.length != 0);
        assertEq(IHyperSwapV3Router(ROUTER).factory(), FACTORY);
        assertEq(IHyperSwapV3Router(ROUTER).WETH9(), WHYPE);
        assertEq(IHyperSwapV3PositionManager(NFPM).factory(), FACTORY);
        assertEq(IHyperSwapV3PositionManager(NFPM).WETH9(), WHYPE);
        assertEq(uint256(uint24(IHyperSwapV3Factory(FACTORY).feeAmountTickSpacing(10_000))), 200);
    }

    function testCanonicalSafeDeploymentAndFrozenTwoOfThreeConfiguration() public {
        assertTrue(SAFE_SINGLETON.code.length != 0);
        assertTrue(SAFE_PROXY_FACTORY.code.length != 0);
        assertTrue(SAFE_FALLBACK_HANDLER.code.length != 0);

        address[] memory owners = new address[](3);
        owners[0] = SAFE_SIGNER_1;
        owners[1] = SAFE_SIGNER_2;
        owners[2] = SAFE_SIGNER_3;
        bytes memory initializer = abi.encodeCall(
            ISafe.setup,
            (
                owners,
                2,
                address(0),
                bytes(""),
                SAFE_FALLBACK_HANDLER,
                address(0),
                0,
                payable(address(0))
            )
        );

        bytes32 salt = keccak256(abi.encodePacked(keccak256(initializer), SAFE_SALT_NONCE));
        bytes memory deploymentData = abi.encodePacked(
            ISafeProxyFactory(SAFE_PROXY_FACTORY).proxyCreationCode(), uint256(uint160(SAFE_SINGLETON))
        );
        address predicted = address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), SAFE_PROXY_FACTORY, salt, keccak256(deploymentData)
        )))));
        assertEq(predicted, EXPECTED_SAFE);
        // Before the production Safe exists, prove the canonical CREATE2 deployment on the fork.
        // After deployment, attest the live proxy directly instead of requiring an obsolete empty
        // address. Fork tests must remain valid on both sides of this one-way release milestone.
        address deployed = EXPECTED_SAFE;
        if (deployed.code.length == 0) {
            deployed = ISafeProxyFactory(SAFE_PROXY_FACTORY).createProxyWithNonce(
                SAFE_SINGLETON, initializer, SAFE_SALT_NONCE
            );
        }
        assertEq(deployed, EXPECTED_SAFE);
        ISafe safe = ISafe(deployed);
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners().length, 3);
        assertTrue(safe.isOwner(SAFE_SIGNER_1));
        assertTrue(safe.isOwner(SAFE_SIGNER_2));
        assertTrue(safe.isOwner(SAFE_SIGNER_3));
        assertEq(keccak256(bytes(safe.VERSION())), keccak256(bytes("1.4.1")));
        (address[] memory modules, address next) = safe.getModulesPaginated(address(0x1), 10);
        assertEq(modules.length, 0);
        assertEq(next, address(0x1));
    }

    function testAtomicLockedLaunchAndProtocolBuyAgainstProjectXMainnetFork() public {
        FWATokenHyperEVMFactory launchFactory = new FWATokenHyperEVMFactory(
            "Hyper World Assets Fork Test",
            "tHWA",
            1_000_000 ether,
            500_000 ether,
            FACTORY,
            NFPM,
            WHYPE,
            address(this),
            address(this),
            address(this),
            uint160(1 << 96),
            4_000
        );
        FWATokenHyperEVM token = launchFactory.token();

        address pool = IHyperSwapV3Factory(FACTORY).getPool(WHYPE, address(token), 10_000);
        HWAProjectXLiquidityLocker locker = HWAProjectXLiquidityLocker(token.liquidityLocker());
        assertTrue(pool != address(0));
        assertEq(token.pool(), pool);
        assertEq(token.balanceOf(pool), 500_000 ether);
        assertTrue(locker.bound());
        assertEq(locker.tokenId(), token.lpTokenId());
        assertEq(IHyperSwapV3PositionManager(NFPM).ownerOf(token.lpTokenId()), address(locker));
        (uint160 price,,,,, uint8 feeProtocol,) = IHyperSwapV3Pool(pool).slot0();
        assertTrue(price != 0);
        // Project X currently initializes a protocol fee, but HWA deliberately monitors rather
        // than hard-codes it because the Project X factory owner can update that value later.
        feeProtocol;

        FWAHyperSwapAdapter adapter =
            new FWAHyperSwapAdapter(FACTORY, ROUTER, WHYPE, address(token), 10_000, address(this));
        FWARewardsHyperEVM rewards = new FWARewardsHyperEVM(address(token), address(adapter), address(this));
        adapter.setRewardsBuyer(address(rewards));
        token.setAdapter(address(adapter));
        token.setRewardsPool(address(rewards));
        rewards.setFWA(address(this));

        vm.deal(address(this), 1 ether);
        uint256 tokenOut = rewards.buyFor{value: 0.01 ether}(USER, 0);
        assertTrue(tokenOut != 0);
        assertEq(token.balanceOf(USER), tokenOut);
        assertEq(address(adapter).balance, 0);
        assertEq(address(rewards).balance, 0);

        // The production buyback waits for a manipulation-resistant V3 TWAP, then derives both
        // bounds from live pool state. This is the real Project X pool, not the local V3 mock.
        vm.warp(block.timestamp + token.BUYBACK_TWAP_SECONDS() + 1);
        vm.roll(block.number + 1);
        vm.deal(address(token), 0.01 ether);
        uint256 boughtBack = token.buyback();
        assertTrue(boughtBack != 0);
        assertEq(address(token).balance, 0);
        assertEq(address(adapter).balance, 0);
    }
}

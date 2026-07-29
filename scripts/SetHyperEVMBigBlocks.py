#!/usr/bin/env python3
"""Toggle HyperEVM big-block routing for the explicitly configured mainnet deployer."""

import argparse
import os

from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.utils import constants


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("on", "off"))
    args = parser.parse_args()

    private_key = os.environ.get("PRIVATE_KEY", "").strip()
    configured_owner = os.environ.get("FWA_OWNER", "").strip()
    accepted = os.environ.get("MAINNET_EOA_OWNER_CONFIRMED", "").lower() == "true"
    if not private_key or not configured_owner or not accepted:
        raise SystemExit("Explicit mainnet EOA owner configuration is incomplete")

    account = Account.from_key(private_key)
    if account.address.lower() != configured_owner.lower():
        raise SystemExit("PRIVATE_KEY does not match the configured mainnet owner")

    exchange = Exchange(
        account,
        constants.MAINNET_API_URL,
        account_address=configured_owner,
        timeout=30.0,
    )
    enable = args.mode == "on"
    response = exchange.use_big_blocks(enable)
    if not isinstance(response, dict) or response.get("status") != "ok":
        raise SystemExit(f"HyperCore rejected the big-block action: {response!r}")
    print(f"HyperEVM big-block routing requested: {str(enable).lower()}")


if __name__ == "__main__":
    main()

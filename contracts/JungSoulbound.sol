// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title JungSoulbound — 정은 사고팔 수 없다
 * @notice Soulbound NFT for main chain completers.
 *         Non-transferable. Your 정 is yours alone.
 */
contract JungSoulbound is ERC721 {
    using Strings for uint256;
    using Strings for uint8;

    struct JungRecord {
        bytes32 chainId;
        uint8 slotIndex;        // which timezone you participated in
        uint8 chainLength;      // should be 24 for complete chain
        uint8 humanCount;       // humans in the main chain
        uint256 completedAt;    // completion timestamp
    }

    mapping(uint256 => JungRecord) public records;
    uint256 public totalMinted;

    address public jungBlock;   // JungBlock contract
    address public operator;

    event JungMinted(
        address indexed to,
        uint256 indexed tokenId,
        bytes32 indexed chainId,
        uint8 slotIndex
    );

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor(address _jungBlock) ERC721("Jung Soulbound", "JUNG") {
        jungBlock = _jungBlock;
        operator = msg.sender;
    }

    /**
     * @notice Mint soulbound NFT for main chain participant
     */
    function mint(
        address to,
        bytes32 chainId,
        uint8 slotIndex,
        uint8 chainLength,
        uint8 humanCount
    ) external onlyOperator returns (uint256 tokenId) {
        tokenId = ++totalMinted;

        records[tokenId] = JungRecord({
            chainId: chainId,
            slotIndex: slotIndex,
            chainLength: chainLength,
            humanCount: humanCount,
            completedAt: block.timestamp
        });

        _safeMint(to, tokenId);

        emit JungMinted(to, tokenId, chainId, slotIndex);
    }

    /**
     * @notice Soulbound: block all transfers
     */
    function _update(address to, uint256 tokenId, address auth) 
        internal override returns (address) 
    {
        address from = _ownerOf(tokenId);
        // Allow minting (from == 0) but block transfers
        require(from == address(0), "SOULBOUND: non-transferable");
        return super._update(to, tokenId, auth);
    }

    /**
     * @notice On-chain SVG metadata
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        JungRecord memory r = records[tokenId];

        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
            '<rect width="400" height="400" fill="#1a1a2e"/>',
            '<text x="200" y="120" text-anchor="middle" font-size="80" fill="#e94560">',
            unicode'情',
            '</text>',
            '<text x="200" y="180" text-anchor="middle" font-size="20" fill="#eee" font-family="monospace">',
            'JUNG CHAIN #', tokenId.toString(),
            '</text>',
            '<text x="200" y="220" text-anchor="middle" font-size="16" fill="#888" font-family="monospace">',
            'Slot ', uint256(r.slotIndex).toString(), '/24',
            '</text>',
            '<text x="200" y="260" text-anchor="middle" font-size="14" fill="#888" font-family="monospace">',
            uint256(r.humanCount).toString(), ' humans connected',
            '</text>',
            '<text x="200" y="320" text-anchor="middle" font-size="12" fill="#555" font-family="monospace">',
            'Proof of Jung',
            '</text>',
            '<text x="200" y="350" text-anchor="middle" font-size="10" fill="#444" font-family="monospace">',
            'soulbound / non-transferable',
            '</text>',
            '</svg>'
        ));

        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"Jung #', tokenId.toString(),
            '","description":"Proof of Jung. Soulbound. Non-transferable. Your participation in a 24-timezone relay chain around the world.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)),
            '","attributes":[',
            '{"trait_type":"Slot","value":', uint256(r.slotIndex).toString(), '},',
            '{"trait_type":"Chain Length","value":', uint256(r.chainLength).toString(), '},',
            '{"trait_type":"Human Count","value":', uint256(r.humanCount).toString(), '}',
            ']}'
        ))));

        return string(abi.encodePacked("data:application/json;base64,", json));
    }
}

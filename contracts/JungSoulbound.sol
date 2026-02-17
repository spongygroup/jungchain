// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title JungSoulbound v6 — 정은 사고팔 수 없다
 * @notice Soulbound NFT for chain completers.
 *         Humans only. No humanScore — everyone who participated is equal.
 *         Non-transferable. Your 정 is yours alone.
 */
contract JungSoulbound is ERC721 {
    using Strings for uint256;

    struct JungRecord {
        bytes32 chainId;
        int8 participantTz;
        uint16 chainLength;     // total blocks in completed chain
        uint16 slotNumber;      // this participant's position (1~24)
        uint256 completedAt;
    }

    mapping(uint256 => JungRecord) public records;
    uint256 public totalMinted;

    address public jungBlock;
    address public operator;

    event JungMinted(
        address indexed to,
        uint256 indexed tokenId,
        bytes32 indexed chainId,
        int8 participantTz,
        uint16 slotNumber
    );

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor(address _jungBlock) ERC721("Jung Soulbound", "JUNG") {
        jungBlock = _jungBlock;
        operator = msg.sender;
    }

    function mint(
        address to,
        bytes32 chainId,
        int8 participantTz,
        uint16 chainLength,
        uint16 slotNumber
    ) external onlyOperator returns (uint256 tokenId) {
        tokenId = ++totalMinted;

        records[tokenId] = JungRecord({
            chainId: chainId,
            participantTz: participantTz,
            chainLength: chainLength,
            slotNumber: slotNumber,
            completedAt: block.timestamp
        });

        _safeMint(to, tokenId);

        emit JungMinted(to, tokenId, chainId, participantTz, slotNumber);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);
        require(from == address(0), "SOULBOUND: non-transferable");
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        JungRecord memory r = records[tokenId];

        string memory tzStr;
        if (r.participantTz >= 0) {
            tzStr = string(abi.encodePacked("UTC+", uint256(int256(r.participantTz)).toString()));
        } else {
            tzStr = string(abi.encodePacked("UTC-", uint256(int256(-r.participantTz)).toString()));
        }

        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
            '<rect width="400" height="400" fill="#1a1a2e"/>',
            '<text x="200" y="120" text-anchor="middle" font-size="80" fill="#e94560">',
            unicode'\u60C5',
            '</text>',
            '<text x="200" y="180" text-anchor="middle" font-size="20" fill="#eee" font-family="monospace">',
            'JUNG #', tokenId.toString(),
            '</text>',
            '<text x="200" y="220" text-anchor="middle" font-size="16" fill="#888" font-family="monospace">',
            tzStr, ' | slot ', uint256(r.slotNumber).toString(), '/24',
            '</text>',
            '<text x="200" y="260" text-anchor="middle" font-size="14" fill="#888" font-family="monospace">',
            uint256(r.chainLength).toString(), ' blocks around the world',
            '</text>',
            '<text x="200" y="320" text-anchor="middle" font-size="12" fill="#555" font-family="monospace">',
            'Proof of Jung',
            '</text>',
            '<text x="200" y="345" text-anchor="middle" font-size="10" fill="#444" font-family="monospace">',
            'soulbound / non-transferable',
            '</text>',
            '</svg>'
        ));

        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"Jung #', tokenId.toString(),
            '","description":"Proof of Jung. A relay chain that traveled around the world and returned home. Slot ',
            uint256(r.slotNumber).toString(), '/24.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)),
            '","attributes":[',
            '{"trait_type":"Timezone","value":"', tzStr, '"},',
            '{"trait_type":"Slot","value":', uint256(r.slotNumber).toString(), '},',
            '{"trait_type":"Chain Length","value":', uint256(r.chainLength).toString(), '}',
            ']}'
        ))));

        return string(abi.encodePacked("data:application/json;base64,", json));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title JungBlock — Proof of 정 (Proof of Jung)
 * @notice Every participation = 1 block on-chain.
 *         Forks emerge when participants set maxNext > 1.
 *         Longest chain = most 정 = truth.
 *         Operator records blocks on behalf of users.
 */
contract JungBlock {
    struct Block {
        bytes32 chainId;
        uint8 slotIndex;       // timezone (0-23)
        bytes32 messageHash;
        bytes32 prevBlockHash;
        address participant;
        bool isHuman;
        uint8 maxNext;         // max recipients for next turn
        uint256 timestamp;
    }

    mapping(bytes32 => Block) public blocks;
    mapping(bytes32 => uint256) public chainBlockCount;
    mapping(bytes32 => bool) public chainCompleted;
    // How many blocks point to a given prevBlockHash
    mapping(bytes32 => uint8) public forkCount;
    // chainId → slotIndex → participant → already participated
    mapping(bytes32 => mapping(uint8 => mapping(address => bool))) public hasParticipated;

    address public operator;
    uint256 public totalBlocks;
    uint8 public maxNextLimit = 5;

    event BlockAdded(
        bytes32 indexed chainId,
        uint8 slotIndex,
        bytes32 blockHash,
        bytes32 prevBlockHash,
        address participant,
        bool isHuman,
        uint8 maxNext
    );

    event ChainCreated(bytes32 indexed chainId, address indexed creator, uint8 startSlot);
    event ChainCompleted(bytes32 indexed chainId);

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    function setMaxNextLimit(uint8 _limit) external onlyOperator {
        require(_limit >= 1, "min 1");
        maxNextLimit = _limit;
    }

    // chainId → creator
    mapping(bytes32 => address) public chainCreator;
    // chainId → active
    mapping(bytes32 => bool) public chainActive;

    function createChain(
        bytes32 chainId,
        address creator,
        uint8 startSlot
    ) external onlyOperator {
        require(!chainActive[chainId], "chain already exists");
        require(startSlot < 24, "invalid start slot");
        chainActive[chainId] = true;
        chainCreator[chainId] = creator;
        emit ChainCreated(chainId, creator, startSlot);
    }

    function addBlock(
        bytes32 chainId,
        uint8 slotIndex,
        bytes32 messageHash,
        bytes32 prevBlockHash,
        address participant,
        bool isHuman,
        uint8 maxNext
    ) external onlyOperator returns (bytes32) {
        require(chainActive[chainId], "chain not active");
        require(slotIndex < 24, "invalid slot");
        require(participant != address(0), "invalid participant");
        require(maxNext >= 1 && maxNext <= maxNextLimit, "exceeds maxNext limit");
        require(!hasParticipated[chainId][slotIndex][participant], "already participated");

        if (slotIndex == 0) {
            require(prevBlockHash == bytes32(0), "genesis has no prev");
        } else {
            Block storage prev = blocks[prevBlockHash];
            require(prev.chainId == chainId, "prev not in chain");
            require(
                prev.slotIndex == slotIndex || prev.slotIndex == slotIndex - 1,
                "invalid slot sequence"
            );
            // Enforce prev block's maxNext limit
            require(forkCount[prevBlockHash] < prev.maxNext, "fork limit reached");
        }

        bytes32 blockHash = keccak256(abi.encodePacked(
            chainId, slotIndex, messageHash, prevBlockHash, participant, block.timestamp
        ));

        blocks[blockHash] = Block(
            chainId, slotIndex, messageHash, prevBlockHash,
            participant, isHuman, maxNext, block.timestamp
        );

        hasParticipated[chainId][slotIndex][participant] = true;

        if (prevBlockHash != bytes32(0)) {
            forkCount[prevBlockHash]++;
        }

        chainBlockCount[chainId]++;
        totalBlocks++;

        emit BlockAdded(chainId, slotIndex, blockHash, prevBlockHash, participant, isHuman, maxNext);

        if (slotIndex == 23 && !chainCompleted[chainId]) {
            chainCompleted[chainId] = true;
            emit ChainCompleted(chainId);
        }

        return blockHash;
    }
}

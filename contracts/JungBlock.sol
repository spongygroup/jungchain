// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title JungBlock v6 — Proof of 정
 * @notice Time-based relay chain. Humans only.
 *
 *  Rules:
 *  - 정각 단위 열림/닫힘 (1시간)
 *  - 롤링 배정 — 스킵 or 이어쓰기
 *  - 1시간 지나면 사라짐
 *  - 24개 정수 타임존 (UTC-11 ~ UTC+12)
 *  - humanScore 없음, 정지기 없음 — 사람만
 *  - 24 슬롯 돌아오면 완주
 */
contract JungBlock {
    struct Block {
        bytes32 chainId;
        bytes32 messageHash;
        bytes32 prevBlockHash;
        address participant;
        int8 timezoneOffset;   // UTC-11 ~ UTC+12
        uint256 timestamp;
    }

    mapping(bytes32 => Block) public blocks;
    mapping(bytes32 => uint256) public chainBlockCount;

    mapping(bytes32 => address) public chainCreator;
    mapping(bytes32 => bool) public chainActive;
    mapping(bytes32 => int8) public chainStartTz;
    mapping(bytes32 => bool) public chainCompleted;

    address public operator;
    address public pendingOperator;
    uint256 public totalBlocks;

    event ChainCreated(bytes32 indexed chainId, address indexed creator, int8 startTz);
    event ChainCompleted(bytes32 indexed chainId, uint256 blockCount);
    event OperatorTransferred(address indexed oldOperator, address indexed newOperator);
    event BlockAdded(
        bytes32 indexed chainId,
        bytes32 blockHash,
        bytes32 prevBlockHash,
        address participant,
        int8 timezoneOffset
    );

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    function transferOperator(address newOperator) external onlyOperator {
        require(newOperator != address(0), "invalid address");
        pendingOperator = newOperator;
    }

    function acceptOperator() external {
        require(msg.sender == pendingOperator, "not pending operator");
        emit OperatorTransferred(operator, msg.sender);
        operator = msg.sender;
        pendingOperator = address(0);
    }

    function createChain(
        bytes32 chainId,
        address creator,
        int8 startTz
    ) external onlyOperator {
        require(!chainActive[chainId], "chain exists");
        require(startTz >= -11 && startTz <= 12, "invalid tz");
        chainActive[chainId] = true;
        chainCreator[chainId] = creator;
        chainStartTz[chainId] = startTz;
        emit ChainCreated(chainId, creator, startTz);
    }

    function addBlock(
        bytes32 chainId,
        bytes32 messageHash,
        bytes32 prevBlockHash,
        address participant,
        int8 timezoneOffset
    ) external onlyOperator returns (bytes32) {
        require(chainActive[chainId], "chain not active");
        require(!chainCompleted[chainId], "chain already completed");
        require(participant != address(0), "invalid participant");
        require(timezoneOffset >= -11 && timezoneOffset <= 12, "invalid tz");

        if (chainBlockCount[chainId] == 0) {
            require(prevBlockHash == bytes32(0), "first block no prev");
        } else {
            require(blocks[prevBlockHash].chainId == chainId, "prev not in chain");
        }

        bytes32 blockHash = keccak256(abi.encodePacked(
            chainId, messageHash, prevBlockHash,
            participant, timezoneOffset, block.timestamp
        ));

        blocks[blockHash] = Block(
            chainId, messageHash, prevBlockHash,
            participant, timezoneOffset, block.timestamp
        );

        chainBlockCount[chainId]++;
        totalBlocks++;

        emit BlockAdded(chainId, blockHash, prevBlockHash, participant, timezoneOffset);

        // 완주 체크: 24블록 도달
        if (chainBlockCount[chainId] == 24) {
            chainCompleted[chainId] = true;
            emit ChainCompleted(chainId, chainBlockCount[chainId]);
        }

        return blockHash;
    }
}

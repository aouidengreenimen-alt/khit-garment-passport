// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title GarmentPassport
/// @notice One shared history for a batch of clothes, written step by step by
///         the companies that made it.
///
///         How it works:
///           1. The owner approves each company, with its name and its country.
///           2. A source of material (a mill) records new material as a lot.
///           3. A company ships a lot to another company. The handover only
///              counts once the receiver confirms it.
///           4. A company turns the lots it holds into a new lot (sewing,
///              washing...). It can never record more weight than it used.
///
///         A passport is a lot and everything it was made from.
///
///         Only fingerprints and weights are stored here. The wording (product
///         name, batch number, number of pieces) stays off the chain.
contract GarmentPassport {
    struct Company {
        string name;
        string country;
        bool approved;
        bool source;   // may record new material
        uint64 since;  // time of the latest approval, in seconds
    }

    struct Lot {
        address maker;        // the company that did this step
        address holder;       // the company that holds the lot now
        uint8 step;           // what was done, see STEP_COUNT
        uint64 createdAt;
        uint64 withdrawnAt;   // 0 while the record stands
        uint64 grams;         // what is left of the lot
        uint64 madeGrams;     // what it weighed when it was recorded
        uint256 shipment;     // the shipment that delivered it, 0 if it was made on the spot
        bytes32 detailsHash;  // fingerprint of the wording kept off the chain
        uint256[] parents;    // the lots it was made from
    }

    enum ShipmentStatus { None, Sent, Received, Refused }

    struct Shipment {
        uint256 lot;          // the lot it was taken from
        address from;
        address to;
        uint64 grams;
        uint64 sentAt;
        uint64 closedAt;      // when the receiver confirmed or refused
        ShipmentStatus status;
        uint256 received;     // the lot created for the receiver, 0 until confirmed
        bytes32 detailsHash;  // fingerprint of the delivery note, may be empty
    }

    /// @notice Number of steps. 0 weaving or knitting, 1 dyeing or printing,
    ///         2 sewing, 3 washing and finishing, 4 other.
    uint8 public constant STEP_COUNT = 5;

    /// @notice The most lots one step can use at once.
    uint256 public constant MAX_INPUTS = 8;

    address public owner;
    uint256 public lotCount;
    uint256 public shipmentCount;

    mapping(address => Company) private companies;
    address[] private companyList;
    mapping(uint256 => Lot) private lots;
    mapping(uint256 => Shipment) private shipments;
    mapping(address => uint256[]) private lotsByHolder;

    event OwnershipTransferred(address indexed from, address indexed to);
    event CompanyApproved(address indexed company, string name, string country, bool source);
    event CompanyRemoved(address indexed company);
    event LotRecorded(uint256 indexed id, address indexed maker, uint8 step, uint64 grams, bytes32 detailsHash);
    event LotShipped(uint256 indexed shipmentId, uint256 indexed lot, address indexed from, address to, uint64 grams);
    event ShipmentConfirmed(uint256 indexed shipmentId, uint256 indexed newLot, address indexed by);
    event ShipmentRefused(uint256 indexed shipmentId, address indexed by);
    event LotWithdrawn(uint256 indexed id, address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only the owner");
        _;
    }

    modifier onlyCompany() {
        require(companies[msg.sender].approved, "Only an approved company");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ───────────────────────── Owner ─────────────────────────

    /// @notice Lets a company write to the passport. Its country is set here,
    ///         by the owner, so a company cannot choose its own.
    ///         Approving the same address again updates its details.
    /// @param source true for a company that may record new material
    function approveCompany(address company, string calldata name, string calldata country, bool source)
        external
        onlyOwner
    {
        require(company != address(0), "Company address missing");
        require(bytes(name).length >= 2 && bytes(name).length <= 80, "Name must be 2 to 80 characters");
        require(bytes(country).length >= 2 && bytes(country).length <= 40, "Country must be 2 to 40 characters");

        Company storage entry = companies[company];
        if (entry.since == 0) companyList.push(company);
        entry.name = name;
        entry.country = country;
        entry.approved = true;
        entry.source = source;
        entry.since = uint64(block.timestamp);
        emit CompanyApproved(company, name, country, source);
    }

    /// @notice Stops a company from writing. What it already recorded stays
    ///         visible, and readers can see the company is no longer approved.
    function removeCompany(address company) external onlyOwner {
        require(companies[company].approved, "Not an approved company");
        companies[company].approved = false;
        emit CompanyRemoved(company);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner address missing");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ───────────────────────── Companies ─────────────────────────

    /// @notice Records new material. Only a source of material can do this:
    ///         every other company works with what it received.
    function record(uint8 step, uint64 grams, bytes32 detailsHash) external onlyCompany returns (uint256 id) {
        require(companies[msg.sender].source, "Only a source of material");
        require(grams > 0, "Weight missing");
        id = _newLot(msg.sender, msg.sender, step, grams, 0, detailsHash);
        emit LotRecorded(id, msg.sender, step, grams, detailsHash);
    }

    /// @notice Sends part or all of a lot to another company.
    ///         The weight leaves the sender's lot at once and reaches the
    ///         receiver only when the receiver confirms.
    function ship(uint256 lotId, address to, uint64 grams, bytes32 detailsHash)
        external
        onlyCompany
        returns (uint256 shipmentId)
    {
        Lot storage lot = _held(lotId);
        require(companies[to].approved, "The receiver is not an approved company");
        require(to != msg.sender, "A company cannot ship to itself");
        require(grams > 0, "Weight missing");
        require(grams <= lot.grams, "More than this lot holds");

        lot.grams -= grams;
        shipmentId = ++shipmentCount;
        shipments[shipmentId] = Shipment({
            lot: lotId,
            from: msg.sender,
            to: to,
            grams: grams,
            sentAt: uint64(block.timestamp),
            closedAt: 0,
            status: ShipmentStatus.Sent,
            received: 0,
            detailsHash: detailsHash
        });
        emit LotShipped(shipmentId, lotId, msg.sender, to, grams);
    }

    /// @notice The receiver says the goods arrived. From now on it holds them.
    function confirm(uint256 shipmentId) external onlyCompany returns (uint256 id) {
        Shipment storage shipment = _waiting(shipmentId);
        Lot storage sent = lots[shipment.lot];

        id = _newLot(sent.maker, msg.sender, sent.step, shipment.grams, shipmentId, sent.detailsHash);
        lots[id].parents.push(shipment.lot);

        shipment.status = ShipmentStatus.Received;
        shipment.closedAt = uint64(block.timestamp);
        shipment.received = id;
        emit ShipmentConfirmed(shipmentId, id, msg.sender);
    }

    /// @notice The receiver says the goods did not arrive, or are not what was
    ///         announced. The weight goes back to the sender's lot.
    function refuse(uint256 shipmentId) external {
        Shipment storage shipment = _waiting(shipmentId);
        lots[shipment.lot].grams += shipment.grams;
        shipment.status = ShipmentStatus.Refused;
        shipment.closedAt = uint64(block.timestamp);
        emit ShipmentRefused(shipmentId, msg.sender);
    }

    /// @notice Turns lots the company holds into a new lot: sewing, washing...
    ///         The new lot can never weigh more than what was used to make it.
    /// @param inputs    the lots used
    /// @param gramsUsed how much of each lot was used
    function transform(
        uint256[] calldata inputs,
        uint64[] calldata gramsUsed,
        uint8 step,
        uint64 gramsOut,
        bytes32 detailsHash
    ) external onlyCompany returns (uint256 id) {
        require(inputs.length > 0 && inputs.length <= MAX_INPUTS, "Use 1 to 8 lots");
        require(inputs.length == gramsUsed.length, "One weight per lot");

        uint256 total = 0;
        for (uint256 i = 0; i < inputs.length; i++) {
            Lot storage used = _held(inputs[i]);
            require(gramsUsed[i] > 0, "Weight missing");
            require(gramsUsed[i] <= used.grams, "More than this lot holds");
            used.grams -= gramsUsed[i];
            total += gramsUsed[i];
        }
        require(gramsOut > 0, "Weight missing");
        require(gramsOut <= total, "More out than in");

        id = _newLot(msg.sender, msg.sender, step, gramsOut, 0, detailsHash);
        for (uint256 i = 0; i < inputs.length; i++) lots[id].parents.push(inputs[i]);
        emit LotRecorded(id, msg.sender, step, gramsOut, detailsHash);
    }

    /// @notice The company that recorded a step takes it back, for example
    ///         after an error. Every passport built on it shows the withdrawal.
    function withdraw(uint256 lotId) external {
        Lot storage lot = _existing(lotId);
        require(lot.shipment == 0 && lot.maker == msg.sender, "Only the company that recorded this step");
        require(lot.withdrawnAt == 0, "Already withdrawn");
        lot.withdrawnAt = uint64(block.timestamp);
        emit LotWithdrawn(lotId, msg.sender);
    }

    // ───────────────────────── Reading ─────────────────────────

    function getCompany(address company) external view returns (Company memory) {
        return companies[company];
    }

    /// @notice Every company ever approved, in order. Check `approved` on each.
    function getCompanies() external view returns (address[] memory) {
        return companyList;
    }

    function getLot(uint256 id) external view returns (Lot memory) {
        require(id != 0 && id <= lotCount, "Lot does not exist");
        return lots[id];
    }

    function getShipment(uint256 id) external view returns (Shipment memory) {
        require(id != 0 && id <= shipmentCount, "Shipment does not exist");
        return shipments[id];
    }

    /// @notice Ids of every lot recorded for a company, oldest first.
    function lotsOf(address holder) external view returns (uint256[] memory) {
        return lotsByHolder[holder];
    }

    // ───────────────────────── Internal ─────────────────────────

    function _existing(uint256 id) private view returns (Lot storage lot) {
        require(id != 0 && id <= lotCount, "Lot does not exist");
        lot = lots[id];
    }

    /// A lot the caller holds and that still stands.
    function _held(uint256 id) private view returns (Lot storage lot) {
        lot = _existing(id);
        require(lot.holder == msg.sender, "You do not hold this lot");
        require(lot.withdrawnAt == 0, "This lot was withdrawn");
    }

    /// A shipment addressed to the caller that is still on its way.
    function _waiting(uint256 id) private view returns (Shipment storage shipment) {
        require(id != 0 && id <= shipmentCount, "Shipment does not exist");
        shipment = shipments[id];
        require(shipment.status == ShipmentStatus.Sent, "Shipment is not on its way");
        require(shipment.to == msg.sender, "Only the receiver");
    }

    function _newLot(address maker, address holder, uint8 step, uint64 grams, uint256 shipment, bytes32 detailsHash)
        private
        returns (uint256 id)
    {
        require(step < STEP_COUNT, "Unknown step");
        id = ++lotCount;
        Lot storage lot = lots[id];
        lot.maker = maker;
        lot.holder = holder;
        lot.step = step;
        lot.createdAt = uint64(block.timestamp);
        lot.grams = grams;
        lot.madeGrams = grams;
        lot.shipment = shipment;
        lot.detailsHash = detailsHash;
        lotsByHolder[holder].push(id);
    }
}

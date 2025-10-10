// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VolcanicAshAnalysis is SepoliaConfig {
    struct EncryptedObservation {
        address agency;
        euint32 encryptedAshConcentration; // Encrypted ash concentration
        euint32 encryptedWindSpeed;          // Encrypted wind speed
        euint32 encryptedWindDirection;      // Encrypted wind direction
        euint32 encryptedLatitude;           // Encrypted latitude
        euint32 encryptedLongitude;          // Encrypted longitude
        uint256 timestamp;
    }
    
    struct AshCloudModel {
        euint32 encryptedTrajectory; // Encrypted trajectory prediction
        bool isComputed;
    }
    
    struct AviationAlert {
        string alertLevel;
        bool isRevealed;
    }

    // Contract state
    uint256 public observationCount;
    mapping(uint256 => EncryptedObservation) public observations;
    mapping(uint256 => AshCloudModel) public cloudModels;
    mapping(uint256 => AviationAlert) public aviationAlerts;
    
    // Region tracking
    mapping(uint256 => uint256[]) private regionObservations;
    
    // Decryption tracking
    mapping(uint256 => uint256) private requestToRegionId;
    
    // Events
    event ObservationSubmitted(uint256 indexed id, address indexed agency);
    event ModelComputed(uint256 indexed regionId);
    event AlertGenerated(uint256 indexed regionId);
    event DecryptionRequested(uint256 indexed regionId);

    /// @notice Submit encrypted observation data
    function submitObservation(
        euint32 encryptedAshConcentration,
        euint32 encryptedWindSpeed,
        euint32 encryptedWindDirection,
        euint32 encryptedLatitude,
        euint32 encryptedLongitude
    ) public {
        observationCount++;
        uint256 newId = observationCount;
        
        observations[newId] = EncryptedObservation({
            agency: msg.sender,
            encryptedAshConcentration: encryptedAshConcentration,
            encryptedWindSpeed: encryptedWindSpeed,
            encryptedWindDirection: encryptedWindDirection,
            encryptedLatitude: encryptedLatitude,
            encryptedLongitude: encryptedLongitude,
            timestamp: block.timestamp
        });
        
        // Group observations by region (simplified)
        uint256 regionId = getRegionId(encryptedLatitude, encryptedLongitude);
        regionObservations[regionId].push(newId);
        
        emit ObservationSubmitted(newId, msg.sender);
    }

    /// @notice Compute ash cloud trajectory model
    function computeTrajectoryModel(uint256 regionId) public {
        require(regionObservations[regionId].length > 0, "No data for region");
        require(!cloudModels[regionId].isComputed, "Already computed");
        
        euint32 avgAsh = FHE.asEuint32(0);
        euint32 avgWindSpeed = FHE.asEuint32(0);
        euint32 avgWindDirection = FHE.asEuint32(0);
        uint256 dataCount = regionObservations[regionId].length;
        
        // Calculate averages
        for (uint i = 0; i < dataCount; i++) {
            uint256 obsId = regionObservations[regionId][i];
            avgAsh = FHE.add(avgAsh, observations[obsId].encryptedAshConcentration);
            avgWindSpeed = FHE.add(avgWindSpeed, observations[obsId].encryptedWindSpeed);
            avgWindDirection = FHE.add(avgWindDirection, observations[obsId].encryptedWindDirection);
        }
        
        // Compute averages
        avgAsh = FHE.div(avgAsh, FHE.asEuint32(uint32(dataCount)));
        avgWindSpeed = FHE.div(avgWindSpeed, FHE.asEuint32(uint32(dataCount)));
        avgWindDirection = FHE.div(avgWindDirection, FHE.asEuint32(uint32(dataCount)));
        
        // Simplified trajectory model: trajectory = ash * wind speed * wind direction
        cloudModels[regionId].encryptedTrajectory = FHE.mul(
            avgAsh,
            FHE.mul(avgWindSpeed, avgWindDirection)
        );
        cloudModels[regionId].isComputed = true;
        
        emit ModelComputed(regionId);
    }

    /// @notice Generate aviation alert
    function generateAviationAlert(uint256 regionId) public {
        require(cloudModels[regionId].isComputed, "Model not computed");
        
        // Prepare encrypted data for decryption
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(cloudModels[regionId].encryptedTrajectory);
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.generateAlertCallback.selector);
        requestToRegionId[reqId] = regionId;
        
        emit DecryptionRequested(regionId);
    }

    /// @notice Handle alert generation callback
    function generateAlertCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 regionId = requestToRegionId[requestId];
        require(regionId != 0, "Invalid request");
        
        AviationAlert storage alert = aviationAlerts[regionId];
        require(!alert.isRevealed, "Alert already generated");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 trajectory = abi.decode(cleartexts, (uint32));
        
        // Determine alert level based on trajectory prediction
        if (trajectory > 1000000) {
            alert.alertLevel = "Severe";
        } else if (trajectory > 500000) {
            alert.alertLevel = "High";
        } else if (trajectory > 100000) {
            alert.alertLevel = "Moderate";
        } else {
            alert.alertLevel = "Low";
        }
        
        alert.isRevealed = true;
        
        emit AlertGenerated(regionId);
    }

    /// @notice Get encrypted trajectory model
    function getEncryptedModel(uint256 regionId) public view returns (euint32) {
        require(cloudModels[regionId].isComputed, "Not computed");
        return cloudModels[regionId].encryptedTrajectory;
    }

    /// @notice Get aviation alert
    function getAviationAlert(uint256 regionId) public view returns (string memory) {
        require(aviationAlerts[regionId].isRevealed, "Not generated");
        return aviationAlerts[regionId].alertLevel;
    }

    /// @notice Helper to determine region ID
    function getRegionId(euint32 latitude, euint32 longitude) private pure returns (uint256) {
        // Simplified region grouping (in real implementation, use proper geohashing)
        return uint256(FHE.toBytes32(latitude)) ^ uint256(FHE.toBytes32(longitude));
    }

    /// @notice Get observation count for region
    function getRegionObservationCount(uint256 regionId) public view returns (uint256) {
        return regionObservations[regionId].length;
    }
}
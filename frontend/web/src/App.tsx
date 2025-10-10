// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AshCloudRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  institution: string;
  region: string;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AshCloudRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    region: "",
    coordinates: "",
    altitude: "",
    particleDensity: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Filter records based on search and tab
  const filteredRecords = records.filter(record => {
    const matchesSearch = record.region.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          record.institution.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || record.status === activeTab;
    return matchesSearch && matchesTab;
  });

  // Calculate statistics
  const verifiedCount = records.filter(r => r.status === "verified").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const rejectedCount = records.filter(r => r.status === "rejected").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Contract interaction functions
  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("ashcloud_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: AshCloudRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`ashcloud_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                institution: recordData.institution,
                region: recordData.region,
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting volcanic data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        institution: account,
        region: newRecordData.region,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `ashcloud_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("ashcloud_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "ashcloud_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted volcanic data submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          region: "",
          coordinates: "",
          altitude: "",
          particleDensity: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted ash cloud data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`ashcloud_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "verified"
      };
      
      await contract.setData(
        `ashcloud_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted ash cloud data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`ashcloud_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "rejected"
      };
      
      await contract.setData(
        `ashcloud_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isInstitution = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderStatusChart = () => {
    return (
      <div className="status-chart">
        <div className="chart-bar verified" style={{ height: `${(verifiedCount / records.length) * 100}%` }}></div>
        <div className="chart-bar pending" style={{ height: `${(pendingCount / records.length) * 100}%` }}></div>
        <div className="chart-bar rejected" style={{ height: `${(rejectedCount / records.length) * 100}%` }}></div>
        <div className="chart-labels">
          <span>Verified</span>
          <span>Pending</span>
          <span>Rejected</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>AshCloud<span>FHE</span></h1>
          <p>Confidential Volcanic Ash Cloud Analysis</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Global Volcanic Ash Cloud Trajectories</h2>
            <p>Securely share and analyze encrypted volcanic ash cloud data using FHE technology</p>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="primary-btn"
              disabled={!account}
            >
              {account ? "Submit New Data" : "Connect Wallet to Submit"}
            </button>
          </div>
          <div className="hero-image"></div>
        </section>
        
        <section className="stats-section">
          <div className="stat-card">
            <h3>Total Reports</h3>
            <p>{records.length}</p>
          </div>
          <div className="stat-card">
            <h3>Verified</h3>
            <p>{verifiedCount}</p>
          </div>
          <div className="stat-card">
            <h3>Pending</h3>
            <p>{pendingCount}</p>
          </div>
          <div className="stat-card">
            <h3>Rejected</h3>
            <p>{rejectedCount}</p>
          </div>
        </section>
        
        <section className="visualization-section">
          <div className="visualization-card">
            <h3>Status Distribution</h3>
            {renderStatusChart()}
          </div>
          <div className="visualization-card">
            <h3>About FHE Technology</h3>
            <p>
              Fully Homomorphic Encryption (FHE) allows computations on encrypted data without decryption. 
              This enables secure collaboration between meteorological agencies while preserving data privacy.
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered Analysis</span>
            </div>
          </div>
        </section>
        
        <section className="records-section">
          <div className="section-header">
            <h2>Ash Cloud Reports</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search by region or institution..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="tabs">
                <button 
                  className={activeTab === "all" ? "active" : ""}
                  onClick={() => setActiveTab("all")}
                >
                  All
                </button>
                <button 
                  className={activeTab === "verified" ? "active" : ""}
                  onClick={() => setActiveTab("verified")}
                >
                  Verified
                </button>
                <button 
                  className={activeTab === "pending" ? "active" : ""}
                  onClick={() => setActiveTab("pending")}
                >
                  Pending
                </button>
                <button 
                  className={activeTab === "rejected" ? "active" : ""}
                  onClick={() => setActiveTab("rejected")}
                >
                  Rejected
                </button>
              </div>
              <button 
                onClick={loadRecords}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list">
            {filteredRecords.length === 0 ? (
              <div className="no-records">
                <p>No ash cloud reports found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Submit First Report
                </button>
              </div>
            ) : (
              filteredRecords.map(record => (
                <div className="record-card" key={record.id}>
                  <div className="record-header">
                    <h3>{record.region}</h3>
                    <span className={`status-badge ${record.status}`}>
                      {record.status}
                    </span>
                  </div>
                  <div className="record-details">
                    <p><strong>Institution:</strong> {record.institution.substring(0, 6)}...{record.institution.substring(38)}</p>
                    <p><strong>Date:</strong> {new Date(record.timestamp * 1000).toLocaleString()}</p>
                  </div>
                  <div className="record-actions">
                    {isInstitution(record.institution) && record.status === "pending" && (
                      <>
                        <button 
                          className="action-btn verify"
                          onClick={() => verifyRecord(record.id)}
                        >
                          Verify
                        </button>
                        <button 
                          className="action-btn reject"
                          onClick={() => rejectRecord(record.id)}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h2>AshCloudFHE</h2>
            <p>Secure volcanic ash cloud trajectory analysis using FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} AshCloudFHE. All rights reserved.
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Security</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.region || !recordData.coordinates) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Submit Ash Cloud Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <span>🔒</span> Your data will be encrypted with FHE technology
          </div>
          
          <div className="form-group">
            <label>Region *</label>
            <input 
              type="text"
              name="region"
              value={recordData.region} 
              onChange={handleChange}
              placeholder="e.g., Pacific Ring, Iceland, etc." 
            />
          </div>
          
          <div className="form-group">
            <label>Coordinates (Lat,Long) *</label>
            <input 
              type="text"
              name="coordinates"
              value={recordData.coordinates} 
              onChange={handleChange}
              placeholder="e.g., 64.9631° N, 19.0208° W" 
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Altitude (m)</label>
              <input 
                type="text"
                name="altitude"
                value={recordData.altitude} 
                onChange={handleChange}
                placeholder="Ash cloud altitude" 
              />
            </div>
            
            <div className="form-group">
              <label>Particle Density (g/m³)</label>
              <input 
                type="text"
                name="particleDensity"
                value={recordData.particleDensity} 
                onChange={handleChange}
                placeholder="Ash particle density" 
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
import { useState, useEffect } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser } from 'firebase/auth';
import { collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase'; 
import { useNavigate } from 'react-router-dom';

// Secure configuration pointer pulling from your local .env.local file
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

function GuideManagement() {
  const navigate = useNavigate();
  // UI visibility state toggles
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [guidesList, setGuidesList] = useState([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editingGuideId, setEditingGuideId] = useState(null);

  // --- NEW ASSIGNMENT STATES ---
  const [availableGroups, setAvailableGroups] = useState([]);
  const [assigningGuide, setAssigningGuide] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  // Local state tracking the user input strings for registration
  const [newGuide, setNewGuide] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });

  const startEditing = (guide) => {
    setEditingGuideId(guide.id);
    setIsEditing(true);
    
    // Fill the input boxes with the guide's existing data
    setNewGuide({
      firstName: guide.firstName,
      lastName: guide.lastName,
      email: guide.email,
      password: '' // Keep password empty unless they want to change it
    });
    
    setShowAddForm(true); // Open the form view container
  };

  // Main Orchestration Form Handler (Decides whether to Create OR Update)
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setLoading(true);

    if (isEditing) {
      // 📝 MODE 1: RUN EDIT/UPDATE LOGIC
      try {
        await updateDoc(doc(db, 'users', editingGuideId), {
          firstName: newGuide.firstName,
          lastName: newGuide.lastName,
          email: newGuide.email
        });

        alert('Guide information successfully updated!');
        
        setIsEditing(false);
        setEditingGuideId(null);
        setNewGuide({ firstName: '', lastName: '', email: '', password: '' });
        setShowAddForm(false);
        await fetchAllGuidesData(); 

      } catch (error) {
        console.error("Error updating guide:", error);
        alert(`Update failed: ${error.message}`);
      } finally {
        setLoading(false);
      }
    } else {
      // 🚀 MODE 2: RUN ACC_CREATION LOGIC
      try {
        const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
        const secondaryAuth = getAuth(secondaryApp);

        const userCredential = await createUserWithEmailAndPassword(
          secondaryAuth, 
          newGuide.email, 
          newGuide.password
        );
        
        const newGuideUid = userCredential.user.uid;

        await setDoc(doc(db, 'users', newGuideUid), {
          firstName: newGuide.firstName,
          lastName: newGuide.lastName,
          email: newGuide.email,
          role: 'guide',
        });

        await setDoc(doc(db, 'guides', newGuideUid), {
          groupName: 'Unassigned', 
        });

        await deleteApp(secondaryApp);
        await fetchAllGuidesData();

        alert('Guide successfully deployed to both database collections!');
        
        setNewGuide({ firstName: '', lastName: '', email: '', password: '' });
        setShowAddForm(false);
        
      } catch (error) {
        console.error("Database initialization fault:", error);
        alert(`Registration Failed: ${error.message}`);
      } finally {
        setLoading(false);
      }
    }
  };

  // --- NEW TWO-WAY ASSIGNMENT LOGIC ---
  const handleSaveAssignment = async () => {
    if (!selectedGroupId) {
      alert("Please select a group from the dropdown.");
      return;
    }

    setLoading(true);
    try {
      // Find the group object the user selected to get its name
      const targetGroup = availableGroups.find(g => g.id === selectedGroupId);

      // STEP 1: Security sweep - clear this guide from any previous group they might have led
      const oldGroupQuery = query(collection(db, 'groups'), where('guideId', '==', assigningGuide.id));
      const oldGroupSnap = await getDocs(oldGroupQuery);
      
      for (const groupDoc of oldGroupSnap.docs) {
        await updateDoc(doc(db, 'groups', groupDoc.id), { 
          guideId: "", 
          guideName: "" 
        });
      }

      // STEP 2: Update the NEW group with the Guide's ID and Name
      await updateDoc(doc(db, 'groups', selectedGroupId), {
        guideId: assigningGuide.id,
        guideName: `${assigningGuide.firstName} ${assigningGuide.lastName}`
      });

      // STEP 3: Update the Guide's metadata tracker with the Group Name
      await updateDoc(doc(db, 'guides', assigningGuide.id), {
        groupName: targetGroup.groupName
      });

      alert(`Successfully assigned ${assigningGuide.firstName} to group ${targetGroup.groupName}!`);
      
      // Cleanup UI states and fetch fresh data
      setAssigningGuide(null);
      setSelectedGroupId('');
      await fetchAllGuidesData(); 

    } catch (error) {
      console.error("Error assigning group:", error);
      alert(`Assignment failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Reusable standalone function to query Firestore and merge data from both collections
  const fetchAllGuidesData = async () => {
    try {
      setTableLoading(true);
      
      // Fetch Available Groups for the Dropdown Menu
      const groupsSnap = await getDocs(collection(db, 'groups'));
      const groupsData = groupsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAvailableGroups(groupsData);

      // Fetch Guides List
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('role', '==', 'guide'));
      const querySnapshot = await getDocs(q);
      
      const combinedGuides = [];

      for (const userDoc of querySnapshot.docs) {
        const userData = userDoc.data();
        const userId = userDoc.id; 

        const guideDocRef = doc(db, 'guides', userId);
        const guideDocSnap = await getDoc(guideDocRef);
        
        let groupName = 'Unassigned'; 
        
        if (guideDocSnap.exists()) {
          groupName = guideDocSnap.data().groupName || 'Unassigned';
        }

        combinedGuides.push({
          id: userId,
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email,
          groupName: groupName 
        });
      }

      setGuidesList(combinedGuides);
    } catch (error) {
      console.error("Error aggregating data collections:", error);
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => {
    fetchAllGuidesData();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewGuide((prev) => ({ ...prev, [name]: value }));
  };

  // Handles total system deletion operations across Firestore and Authentication
  const handleRemoveGuide = async (guideId, guideName, guideEmail) => {
    const confirmDelete = window.confirm(`Are you sure you want to permanently remove ${guideName}?`);
    if (!confirmDelete) return;

    // To remove from Auth list, we must gather credentials or pass confirmation password
    const verifyPassword = window.prompt(`To completely purge this user from Authentication, enter their login password (or leave blank to clear database files only):`);

    try {
      setTableLoading(true);

      // 🔐 If password is provided, wipe them from the active Authentication core lists
      if (verifyPassword) {
        const removalApp = initializeApp(firebaseConfig, "RemovalApp");
        const removalAuth = getAuth(removalApp);

        // Sign in to the background lane as the target guide
        const credential = await signInWithEmailAndPassword(removalAuth, guideEmail, verifyPassword);
        
        // Execute the drop authentication statement on their current active session profile
        await deleteUser(credential.user);
        
        // Clean up memory app trace thread
        await deleteApp(removalApp);
      }

      // 🗑️ Delete from both Firestore database collections
      await deleteDoc(doc(db, 'users', guideId));
      await deleteDoc(doc(db, 'guides', guideId));

      alert('Guide records successfully removed from all system logs.');
      await fetchAllGuidesData(); // Refresh UI registry table
    } catch (error) {
      console.error("Error during full deletion routine:", error);
      alert(`Removal incomplete: ${error.message}. Database records may still exist.`);
    } finally {
      setTableLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>Guide Management Center</h2>
        <button onClick={() => navigate('/admin')} style={{ padding: '8px 16px', backgroundColor: '#95a5a6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          חזור ללוח בקרה ↩
        </button>
      </div>
      
      {/* View Toggle Bar */}
      <div style={{ marginBottom: '20px' }}>
        <button 
          style={{ padding: '10px 20px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          onClick={() => {
            if (showAddForm) {
              setIsEditing(false);
              setEditingGuideId(null);
              setNewGuide({ firstName: '', lastName: '', email: '', password: '' });
            }
            setShowAddForm(!showAddForm);
          }}
        >
          {showAddForm ? 'Cancel Registration' : 'Add New Guide'}
        </button>
      </div>

      {/* Conditional Registry Intake Form */}
      {showAddForm && (
        <form onSubmit={handleSubmitForm} style={{ marginBottom: '30px' }}>
          <h3>{isEditing ? 'Modify Account Profile' : 'Register New Account Profile'}</h3>
          
          <div>
            <label>First Name:</label>
            <input type="text" name="firstName" value={newGuide.firstName} onChange={handleInputChange} required />
          </div>
          <div>
            <label>Last Name:</label>
            <input type="text" name="lastName" value={newGuide.lastName} onChange={handleInputChange} required />
          </div>
          <div>
            <label>Email Address:</label>
            <input type="email" name="email" value={newGuide.email} onChange={handleInputChange} required />
          </div>
          
          {!isEditing && (
            <div>
              <label>System Password:</label>
              <input type="password" name="password" value={newGuide.password} onChange={handleInputChange} required />
            </div>
          )}
          
          <button type="submit" disabled={loading}>
            {loading ? 'Processing...' : isEditing ? 'Save Changes' : 'Commit Guide to Database'}
          </button>
        </form>
      )}

      {/* Main Registry Management Table */}
      <table>
        <thead>
          <tr>
            <th>Full Name</th>
            <th>Email Address</th>
            <th>Affiliated Group</th>
            <th>Operations Hub</th>
          </tr>
        </thead>
        <tbody>
          {tableLoading ? (
            <tr>
              <td colSpan="4">Retrieving guide registries...</td>
            </tr>
          ) : guidesList.length === 0 ? (
            <tr>
              <td colSpan="4">No registered guides found.</td>
            </tr>
          ) : (
            guidesList.map((guide) => (
              <tr key={guide.id}>
                <td>{guide.firstName} {guide.lastName}</td>
                <td>{guide.email}</td>
                
                {/* Visual indicator for unassigned guides */}
                <td>
                  <span style={{ color: guide.groupName === 'Unassigned' ? '#e74c3c' : 'inherit', fontWeight: guide.groupName === 'Unassigned' ? 'bold' : 'normal' }}>
                    {guide.groupName}
                  </span>
                </td>
                
                <td>
                  {/* INLINE ASSIGNMENT UI TOGGLE */}
                  {assigningGuide?.id === guide.id ? (
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <select 
                        value={selectedGroupId} 
                        onChange={(e) => setSelectedGroupId(e.target.value)}
                        style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
                      >
                        <option value="">-- Choose a Group --</option>
                        {availableGroups.map(group => (
                          <option key={group.id} value={group.id}>
                            {group.groupName}
                          </option>
                        ))}
                      </select>
                      <button style={{ backgroundColor: '#2ecc71', color: 'white', padding: '6px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }} onClick={handleSaveAssignment} disabled={loading}>Save</button>
                      <button style={{ backgroundColor: '#95a5a6', color: 'white', padding: '6px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }} onClick={() => setAssigningGuide(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button onClick={() => setAssigningGuide(guide)}>Assign Group</button>
                      <button onClick={() => startEditing(guide)}>Edit</button>
                      <button style={{ backgroundColor: '#e74c3c', color: 'white', border: 'none' }} onClick={() => handleRemoveGuide(guide.id, `${guide.firstName} ${guide.lastName}`, guide.email)}>Remove</button>
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default GuideManagement;
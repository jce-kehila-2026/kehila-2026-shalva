import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import "./AttendanceScreen.css";

function AttendanceScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const passedGroupId = location.state?.groupId;

  const [dbGroups, setDbGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(passedGroupId || "");
  const [selectedGroup, setSelectedGroup] = useState(""); // group name
  const [volunteers, setVolunteers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch groups dynamically from database
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const snapshot = await getDocs(collection(db, "groups"));
        const groupsData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setDbGroups(groupsData);

        if (passedGroupId) {
          const matched = groupsData.find((g) => g.id === passedGroupId);
          if (matched) {
            setSelectedGroup(matched.groupName);
          }
        }
      } catch (err) {
        console.error("Error fetching groups:", err);
      }
    };
    fetchGroups();
  }, [passedGroupId]);

  // Load volunteers when group selection changes
  useEffect(() => {
    if (selectedGroupId) {
      fetchVolunteersByGroup(selectedGroupId);
    } else {
      setVolunteers([]);
    }
  }, [selectedGroupId]);

  const fetchVolunteersByGroup = async (gId) => {
    setLoading(true);

    try {
      const q = query(
        collection(db, "volunteers"),
        where("groupId", "==", gId)
      );

      const snapshot = await getDocs(q);

      const volunteersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        status: false,
      }));

      setVolunteers(volunteersData);
    } catch (error) {
      console.error("Error loading volunteers:", error);
      alert("אירעה שגיאה בטעינת המתנדבים");
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = (id) => {
    setVolunteers((prev) =>
      prev.map((volunteer) =>
        volunteer.id === id
          ? { ...volunteer, status: !volunteer.status }
          : volunteer
      )
    );
  };

  const handleSaveAttendance = async () => {
    if (!selectedGroupId || !selectedGroup) {
      alert("יש לבחור קבוצה");
      return;
    }

    try {
      for (const volunteer of volunteers) {
        await addDoc(collection(db, "attendance"), {
          group: selectedGroup,
          groupId: selectedGroupId,
          date: new Date(),
          status: volunteer.status,
          volunteerId: volunteer.id,
          volunteerName:
            volunteer.name ||
            `${volunteer.firstName || ""} ${volunteer.lastName || ""}`.trim(),
        });
      }

      alert("הנוכחות נשמרה בהצלחה!");
      navigate(-1);
    } catch (error) {
      console.error("Error saving attendance:", error);
      alert("אירעה שגיאה בשמירת הנוכחות");
    }
  };

  return (
    <div className="attendance-page" dir="rtl">
      <div className="attendance-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
          <h1>סימון נוכחות</h1>
          <button className="btn btn-outline" onClick={() => navigate(-1)}>
            ביטול / חזור
          </button>
        </div>
        <p>בחרו קבוצה וסמנו נוכחות למתנדבים.</p>

        <select 
          value={selectedGroupId} 
          onChange={(e) => {
            const gId = e.target.value;
            setSelectedGroupId(gId);
            const matched = dbGroups.find((g) => g.id === gId);
            setSelectedGroup(matched ? matched.groupName : "");
          }}
          disabled={!!passedGroupId}
        >
          <option value="">בחר קבוצה</option>
          {dbGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.groupName}
            </option>
          ))}
        </select>

        {loading && <p>טוען מתנדבים...</p>}

        {!loading && selectedGroupId && volunteers.length === 0 && (
          <p>לא נמצאו מתנדבים בקבוצה זו.</p>
        )}

        {!loading &&
          volunteers.map((volunteer) => (
            <div className="attendance-row" key={volunteer.id}>
              <span>
                {volunteer.name ||
                  `${volunteer.firstName || ""} ${volunteer.lastName || ""}`.trim()}
              </span>

              <label>
                <input
                  type="checkbox"
                  checked={volunteer.status}
                  onChange={() => handleStatusChange(volunteer.id)}
                />
                הגיע/ה
              </label>
            </div>
          ))}

        <button onClick={handleSaveAttendance} disabled={!selectedGroupId || volunteers.length === 0}>
          שמירת נוכחות
        </button>
      </div>
    </div>
  );
}

export default AttendanceScreen;
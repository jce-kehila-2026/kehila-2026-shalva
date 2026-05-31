import React, { useEffect, useState } from "react";
import { db } from "../../firebase";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import "./AttendanceScreen.css";

function AttendanceScreen() {
  const groups = [
    "תותים", "דובדבן", "אתרוג", "ניצן", "רימונים", "תאנים",
    "גפן", "רותם", "אלמוג", "הדרים", "אגוז", "ארז",
    "דולב", "שקדיה", "אלה", "אלונים", "אורנים",
    "דקל", "עמית", "נעם", "איתן", "לביא",
  ];

  const [selectedGroup, setSelectedGroup] = useState("");
  const [volunteers, setVolunteers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedGroup) {
      fetchVolunteersByGroup(selectedGroup);
    } else {
      setVolunteers([]);
    }
  }, [selectedGroup]);

  const fetchVolunteersByGroup = async (groupName) => {
    setLoading(true);

    try {
      const q = query(
        collection(db, "volunteers"),
        where("groupName", "==", groupName)
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
    if (!selectedGroup) {
      alert("יש לבחור קבוצה");
      return;
    }

    try {
      for (const volunteer of volunteers) {
        await addDoc(collection(db, "attendance"), {
          group: selectedGroup,
          date: new Date(),
          status: volunteer.status,
          volunteerId: volunteer.id,
          volunteerName:
            volunteer.name ||
            `${volunteer.firstName || ""} ${volunteer.lastName || ""}`.trim(),
        });
      }

      alert("הנוכחות נשמרה בהצלחה!");
    } catch (error) {
      console.error("Error saving attendance:", error);
      alert("אירעה שגיאה בשמירת הנוכחות");
    }
  };

  return (
    <div className="attendance-page" dir="rtl">
      <div className="attendance-card">
        <h1>סימון נוכחות</h1>
        <p>בחרו קבוצה וסמנו נוכחות למתנדבים.</p>

        <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
          <option value="">בחר קבוצה</option>
          {groups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>

        {loading && <p>טוען מתנדבים...</p>}

        {!loading && selectedGroup && volunteers.length === 0 && (
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

        <button onClick={handleSaveAttendance} disabled={!selectedGroup || volunteers.length === 0}>
          שמירת נוכחות
        </button>
      </div>
    </div>
  );
}

export default AttendanceScreen;
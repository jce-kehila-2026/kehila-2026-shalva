import React, { useState } from "react";
import { db } from "../../firebase";
import { collection, addDoc } from "firebase/firestore";
import { GROUP_NAMES, GROUP_TIMES } from "./groupOptions";
import "./RegistrationScreen.css";

function GroupManagementScreen() {
  const [formData, setFormData] = useState({
    name: "",
    time: "",
    guide: "",
    volunteers: [],
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    await addDoc(collection(db, "groups"), {
      ...formData,
      createdAt: new Date(),
    });

    alert("Group added successfully!");
  };

  return (
    <div className="registration-page">
      <div className="registration-card">
        <h1>Group Management</h1>

        <form onSubmit={handleSubmit}>
          <select name="name" onChange={handleChange} required>
            <option value="">Select Group Name</option>
            {GROUP_NAMES.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </select>

          <select name="time" onChange={handleChange} required>
            <option value="">Select Time</option>
            {GROUP_TIMES.map((time) => (
              <option key={time} value={time}>{time}</option>
            ))}
          </select>

          <input name="guide" placeholder="Guide Name" onChange={handleChange} />

          <button type="submit">Create Group</button>
        </form>
      </div>
    </div>
  );
}

export default GroupManagementScreen;
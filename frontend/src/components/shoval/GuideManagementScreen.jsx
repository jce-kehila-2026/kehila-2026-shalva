import React, { useState } from "react";
import { db } from "../../firebase";
import { collection, addDoc } from "firebase/firestore";
import { GROUP_NAMES } from "./groupOptions";
import "./RegistrationScreen.css";

function GuideManagementScreen() {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    groupName: "",
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    await addDoc(collection(db, "guides"), {
      ...formData,
      createdAt: new Date(),
    });

    alert("Guide added successfully!");
  };

  return (
    <div className="registration-page">
      <div className="registration-card">
        <h1>Guide Management</h1>

        <form onSubmit={handleSubmit}>
          <input name="firstName" placeholder="First Name" onChange={handleChange} required />
          <input name="lastName" placeholder="Last Name" onChange={handleChange} required />

          <select name="groupName" onChange={handleChange} required>
            <option value="">Select Group</option>
            {GROUP_NAMES.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </select>

          <button type="submit">Add Guide</button>
        </form>
      </div>
    </div>
  );
}

export default GuideManagementScreen;
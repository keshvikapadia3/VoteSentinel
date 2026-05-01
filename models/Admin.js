const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema({
    name: String,
    email: { type: String, required: true, unique: true },
    pwdHash: String,
    otp: String,
    otpExpiresAt: Date
}, { timestamps: true });

module.exports = mongoose.model("Admin", AdminSchema);

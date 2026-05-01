const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, required: true, unique: true },
    password: String,
    otp: String,
    otpExpiresAt: Date,
    token: String,
    verified: { type: Boolean, default: false },
    voted: { type: Boolean, default: false }
});

module.exports = mongoose.model("User", UserSchema);
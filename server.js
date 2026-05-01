require("dotenv").config();

const express = require("express");
const { encrypt, decrypt } = require("./utils/encryption");

const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const User = require("./models/User");
const Poll = require("./models/Poll");
const Vote = require("./models/Vote");
const Admin = require("./models/Admin");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

const PORT = process.env.PORT || 5500;

/* ---------------- ADMIN KEY ---------------- */

const ADMIN_KEY = process.env.ADMIN_KEY;

/* ---------------- EMAIL CONFIG ---------------- */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/* ---------------- HOME ROUTE ---------------- */

app.get("/", (req, res) => {
  res.send("SecureVote Backend Running");
});

/* ---------------- SEND OTP ---------------- */

app.post("/send-otp", async (req, res) => {

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email required" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);

  try {
    // Save OTP to database (create user if not exists)
    await User.findOneAndUpdate(
      { email },
      { otp: String(otp), otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      { upsert: true, returnDocument: 'after' }
    );

    await transporter.sendMail({
      from: `"SecureVote" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "SecureVote OTP Verification",
      text: `Your SecureVote OTP is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`
    });

    res.json({ message: "OTP sent successfully" });

  } catch (err) {

    console.error("Email error:", err);
    res.status(500).json({ message: "Email sending failed. Check server config." });

  }

});

/* ---------------- VERIFY OTP ---------------- */

app.post("/verify-otp", async (req, res) => {

  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP required" });
  }

  const user = await User.findOne({ email });

  if (!user || !user.otp) {
    return res.status(400).json({ message: "No OTP found for this email. Request a new one." });
  }

  if (Date.now() > new Date(user.otpExpiresAt).getTime()) {
    user.otp = undefined;
    user.otpExpiresAt = undefined;
    await user.save();
    return res.status(400).json({ message: "OTP has expired. Please request a new one." });
  }

  if (String(user.otp) !== String(otp)) {
    return res.status(400).json({ message: "Invalid OTP" });
  }

  // OTP valid — generate ballot token
  const token = crypto.randomBytes(16).toString("hex");

  user.otp = undefined;
  user.otpExpiresAt = undefined;
    user.verified = true; 
  user.token = token;
  await user.save();

  try {

    await transporter.sendMail({
      from: `"SecureVote" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your SecureVote Ballot Token",
      text: `Your ballot token is: ${token}\n\nThis token is single-use and confidential. Do not share it with anyone.\nPresent it when prompted in the voting portal.`
    });

    /* Return token in response so frontend can auto-fill it */
    res.json({ message: "OTP verified. Ballot token sent to your email.", token });

  } catch (err) {

    console.error("Token email error:", err);
    res.status(500).json({ message: "OTP verified but token email failed. Contact admin." });

  }

});

/* ---------------- ADMIN CREATE POLL ---------------- */

app.post("/admin/create-poll", async (req, res) => {

  const { adminKey, title, candidates } = req.body;

  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(401).json({ message: "Invalid admin key" });
  }

  if (!title || !candidates || !Array.isArray(candidates) || candidates.length < 2) {
    return res.status(400).json({ message: "Title and at least 2 candidates required" });
  }

  try {
    const pollId = Date.now().toString();

    const votesInit = {};
    candidates.forEach(c => { votesInit[c] = 0; });

    const poll = new Poll({ pollId, title, candidates, votes: votesInit });
    await poll.save();

    res.json({ message: "Poll created successfully", pollId });

  } catch (err) {
    console.error("Create poll error:", err);
    res.status(500).json({ message: "Failed to create poll." });
  }

});

/* ---------------- GET POLLS ---------------- */

app.get("/polls", async (req, res) => {

  try {

    const polls = await Poll.find();

    res.json(polls);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch polls."
    });

  }

});

/* ---------------- CAST VOTE ---------------- */

app.post("/vote", async (req, res) => {

  const { email, token, pollId, candidate } = req.body;

  if (!email || !token || !pollId || !candidate) {
    return res.status(400).json({ message: "All fields required: email, token, pollId, candidate" });
  }

  try {
    // Verify ballot token from DB
    const user = await User.findOne({ email });

    if (!user || user.token !== token) {
      return res.status(401).json({ message: "Invalid or expired ballot token" });
    }

    // Check if already voted (in Vote collection)
    const existingVote = await Vote.findOne({ email, pollId });
    if (existingVote) {
      return res.status(400).json({ message: "You have already voted" });
    }

    // Check poll exists
    const poll = await Poll.findOne({ pollId });
    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    // Check candidate is valid
    if (!poll.votes.has(candidate)) {
      return res.status(400).json({ message: "Invalid candidate" });
    }

    // Increment vote count in DB
    poll.votes.set(candidate, poll.votes.get(candidate) + 1);
    await poll.save();

    // Record the vote
    await Vote.create({

   email,

   pollId,

   candidate: encrypt(candidate)

});

    // Invalidate the token (single-use)
    user.token = undefined;
    user.voted = true;
    await user.save();

    res.json({ message: "Vote submitted successfully" });

  } catch (err) {
    console.error("Vote error:", err);
    res.status(500).json({ message: "Vote failed. Try again." });
  }

});

/* ---------------- CHECK VOTE STATUS ---------------- */

app.get("/vote-status/:email", async (req, res) => {

  const { email } = req.params;

  try {
    const vote = await Vote.findOne({ email });
    res.json({ voted: !!vote });
  } catch (err) {
    res.json({ voted: false });
  }

});

/* ================================================================
   VOTER AUTH ROUTES
   ================================================================ */

/* --- Voter Register (save credentials to MongoDB) --- */
app.post("/api/voter/register", async (req, res) => {
  try {
    const { name, email, pwdHash, voterId } = req.body;
    if (!name || !email || !pwdHash) return res.status(400).json({ message: "All fields required." });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "Email already registered." });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await User.create({ name, email, password: pwdHash, voterId, otp, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000) });

    await transporter.sendMail({
      from: `"SecureVote" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "SecureVote Registration OTP",
      text: `Your OTP is: ${otp}\n\nThis code expires in 10 minutes.`
    });

    res.json({ message: "OTP sent successfully" });
  } catch (err) {
    console.error("Voter register error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* --- Voter Login (check credentials in MongoDB + send OTP) --- */
app.post("/api/voter/login", async (req, res) => {
  try {
    const { email, pwdHash } = req.body;
    if (!email || !pwdHash) return res.status(400).json({ message: "Email and password required." });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "No voter account found." });
    if (user.password !== pwdHash) return res.status(401).json({ message: "Incorrect password." });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await transporter.sendMail({
      from: `"SecureVote" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "SecureVote Login OTP",
      text: `Your login OTP is: ${otp}\n\nThis code expires in 10 minutes.`
    });

    res.json({ message: "OTP sent successfully", name: user.name });
  } catch (err) {
    console.error("Voter login error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ================================================================
   ADMIN AUTH ROUTES (stored in MongoDB, OTPs via NodeMailer)
   ================================================================ */

/* --- Admin Register --- */
app.post("/api/admin/register", async (req, res) => {
  try {
    const { name, email, pwdHash, key } = req.body;

    if (!name || !email || !pwdHash || !key) {
      return res.status(400).json({ message: "All fields required." });
    }

    if (key !== ADMIN_KEY) {
      return res.status(401).json({ message: "Invalid admin secret key." });
    }

    const exists = await Admin.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: "Admin account already exists." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await Admin.create({
      name, email, pwdHash,
      otp,
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    await transporter.sendMail({
      from: `"SecureVote" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "SecureVote Admin Registration OTP",
      text: `Your Admin Verification OTP is: ${otp}\n\nThis code expires in 10 minutes.`
    });

    res.json({ message: "Admin registered. OTP sent to your email." });
  } catch (err) {
    console.error("Admin register error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* --- Admin Login --- */
app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, pwdHash } = req.body;

    if (!email || !pwdHash) {
      return res.status(400).json({ message: "Email and password required." });
    }

    const admin = await Admin.findOne({ email, pwdHash });
    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    admin.otp = otp;
    admin.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await admin.save();

    await transporter.sendMail({
      from: `"SecureVote" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "SecureVote Admin Login OTP",
      text: `Your Admin Login OTP is: ${otp}\n\nThis code expires in 10 minutes.`
    });

    res.json({ message: "OTP sent to your email." });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* --- Admin Verify OTP --- */
app.post("/api/admin/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin || !admin.otp) {
      return res.status(400).json({ message: "No OTP found. Request a new one." });
    }

    if (Date.now() > new Date(admin.otpExpiresAt).getTime()) {
      admin.otp = undefined;
      await admin.save();
      return res.status(400).json({ message: "OTP expired. Try logging in again." });
    }

    if (String(admin.otp) !== String(otp)) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    admin.otp = undefined;
    admin.otpExpiresAt = undefined;
    await admin.save();

    res.json({ message: "Verified", name: admin.name });
  } catch (err) {
    console.error("Admin verify error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ---------------- SERVER START ---------------- */

app.listen(PORT, () => {

  console.log(`SecureVote backend running on http://localhost:${PORT}`);

});
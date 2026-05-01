const mongoose = require("mongoose");

const VoteSchema = new mongoose.Schema({
    email: { type: String, required: true },
    pollId: { type: String, required: true },
    candidate: { type: String, required: true },
    votedAt: { type: Date, default: Date.now }
});

// One vote per email per poll
VoteSchema.index({ email: 1, pollId: 1 }, { unique: true });

module.exports = mongoose.model("Vote", VoteSchema);

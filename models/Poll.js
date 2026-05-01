const mongoose = require("mongoose");

const PollSchema = new mongoose.Schema({
    pollId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    candidates: [{ type: String }],
    votes: {
        type: Map,
        of: Number,
        default: {}
    }
});

module.exports = mongoose.model("Poll", PollSchema);

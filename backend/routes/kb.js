const express = require('express');

const router = express.Router();

router.post('/refine', (req, res) => {
  const dataset = Array.isArray(req.body) ? req.body : [];
  res.json({
    dataset,
    stats: {
      processed: dataset.length,
      kept: dataset.length,
      totalDropped: 0,
      dropped: {}
    }
  });
});

module.exports = router;

/**
 * Request/response timeout middleware — 15 seconds
 */
module.exports = (req, res, next) => {
    req.setTimeout(15000);
    res.setTimeout(15000);
    next();
};

import winston from 'winston';
import path from 'path';
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
    defaultMeta: { service: 'intelligent-scraper' },
    transports: [
        new winston.transports.File({
            filename: path.join('logs', 'error.log'),
            level: 'error'
        }),
        new winston.transports.File({
            filename: path.join('logs', 'combined.log')
        }),
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.simple())
        })
    ],
});
export default logger;

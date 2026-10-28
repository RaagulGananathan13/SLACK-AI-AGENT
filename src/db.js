import pg from 'pg';
const { Pool } = pg;

import config from './config.js';
import log from './logger.js';

let pool;

// every statement is idempotent, so the whole list runs on each boot and new
// columns/tables only need a line here
const schema = [
    `CREATE TABLE IF NOT EXISTS member_analyses (
        id SERIAL PRIMARY KEY,
        member_id VARCHAR(255),
        member_name VARCHAR(255) NOT NULL,
        member_email VARCHAR(255),
        member_title VARCHAR(255),
        member_timezone VARCHAR(100),
        fit_score INTEGER NOT NULL,
        insights JSONB,
        recommendations JSONB,
        research_data JSONB,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_to_slack BOOLEAN DEFAULT FALSE,
        sent_to_slack_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_member_id ON member_analyses(member_id)`,
    `CREATE INDEX IF NOT EXISTS idx_analyzed_at ON member_analyses(analyzed_at)`
];

export async function initDatabase(existingPool) {
    pool = existingPool || new Pool({
        connectionString: config.database.url,
        ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        // managed postgres (render, neon) can take a few seconds to wake up
        connectionTimeoutMillis: 10000
    });

    pool.on('error', (err) => {
        log.error('Unexpected database error:', err.message);
    });

    try {
        for (const statement of schema) {
            await pool.query(statement);
        }
        log.info('Database schema initialized');
    } catch (error) {
        log.error('Failed to initialize database:', error.message);
        throw error;
    }
}

function query(text, params) {
    if (!pool) throw new Error('Database not initialized, call initDatabase() first');
    return pool.query(text, params);
}

export async function saveMemberAnalysis(memberInfo, analysis, researchData) {
    const result = await query(
        `INSERT INTO member_analyses (
            member_id,
            member_name,
            member_email,
            member_title,
            member_timezone,
            fit_score,
            insights,
            recommendations,
            research_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
            memberInfo.id || null,
            memberInfo.name,
            memberInfo.email || null,
            memberInfo.title || null,
            memberInfo.timezone || null,
            analysis.fitScore,
            JSON.stringify(analysis.insights),
            JSON.stringify(analysis.recommendations),
            JSON.stringify(researchData)
        ]);

    log.info(`Saved analysis to database with ID: ${result.rows[0].id}`);
    return result.rows[0].id;
}

export async function markAsSentToSlack(analysisId) {
    await query(
        `UPDATE member_analyses
         SET sent_to_slack = TRUE,
            sent_to_slack_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, [analysisId]
    );
}

export async function checkDatabase() {
    try {
        await query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

export async function closeDatabase() {
    if (!pool) return;
    await pool.end();
    pool = null;
    log.info('Database connection pool closed');
}

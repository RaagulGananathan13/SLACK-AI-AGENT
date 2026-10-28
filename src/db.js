import pg from 'pg';
const { Pool } = pg;

import config from './config.js';
import log from './logger.js';

// columns are TIMESTAMP (no zone) written in UTC, but pg would parse them as local time
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, value => new Date(`${value.replace(' ', 'T')}Z`));

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
    `CREATE INDEX IF NOT EXISTS idx_analyzed_at ON member_analyses(analyzed_at)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS confidence VARCHAR(10)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS segment VARCHAR(100)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS summary TEXT`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS welcome_message TEXT`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS model VARCHAR(150)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS slack_channel VARCHAR(50)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS slack_ts VARCHAR(50)`
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

export function toRecord(row) {
    if (!row) return null;
    return {
        id: row.id,
        memberId: row.member_id,
        name: row.member_name,
        email: row.member_email,
        title: row.member_title,
        timezone: row.member_timezone,
        fitScore: row.fit_score,
        confidence: row.confidence,
        segment: row.segment,
        summary: row.summary,
        insights: row.insights || [],
        recommendations: row.recommendations || [],
        welcomeMessage: row.welcome_message,
        research: row.research_data || [],
        model: row.model,
        analyzedAt: row.analyzed_at,
        slackChannel: row.slack_channel,
        slackTs: row.slack_ts
    };
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
            research_data,
            confidence,
            segment,
            summary,
            welcome_message,
            model
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
            JSON.stringify(researchData),
            analysis.confidence || null,
            analysis.segment || null,
            analysis.summary || null,
            analysis.welcomeMessage || null,
            analysis.model || null
        ]);

    log.info(`Saved analysis to database with ID: ${result.rows[0].id}`);
    return result.rows[0].id;
}

export async function getAnalysis(id) {
    const result = await query('SELECT * FROM member_analyses WHERE id = $1', [id]);
    return toRecord(result.rows[0]);
}

export async function markAsSentToSlack(analysisId, message = {}) {
    await query(
        `UPDATE member_analyses
         SET sent_to_slack = TRUE,
            sent_to_slack_at = CURRENT_TIMESTAMP,
            slack_channel = COALESCE($2, slack_channel),
            slack_ts = COALESCE($3, slack_ts),
            updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, [analysisId, message.channel || null, message.ts || null]
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

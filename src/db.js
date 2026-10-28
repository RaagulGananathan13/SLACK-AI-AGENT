import pg from 'pg';
const { Pool } = pg;

import config from './config.js';
import log from './logger.js';

// columns are TIMESTAMP (no zone) written in UTC, but pg would read and write them as local time
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, value => new Date(`${value.replace(' ', 'T')}Z`));
pg.defaults.parseInputDatesAsUTC = true;

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
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS slack_ts VARCHAR(50)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS feedback VARCHAR(20)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS feedback_by VARCHAR(50)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMP`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS welcomed_by VARCHAR(50)`,
    `ALTER TABLE member_analyses ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMP`,
    `CREATE TABLE IF NOT EXISTS analysis_jobs (
        id SERIAL PRIMARY KEY,
        member_id VARCHAR(255) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        run_after TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // one live job per member, so team_join + a few channel joins collapse into one analysis
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_member ON analysis_jobs(member_id) WHERE status IN ('queued', 'running')`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_queued ON analysis_jobs(run_after) WHERE status = 'queued'`
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
        slackTs: row.slack_ts,
        feedback: row.feedback,
        feedbackBy: row.feedback_by,
        feedbackAt: row.feedback_at,
        welcomedBy: row.welcomed_by,
        welcomedAt: row.welcomed_at
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

export async function recordFeedback(id, feedback, userId) {
    await query(
        `UPDATE member_analyses
         SET feedback = $2, feedback_by = $3, feedback_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, [id, feedback, userId]
    );
}

export async function markWelcomed(id, userId) {
    await query(
        `UPDATE member_analyses
         SET welcomed_by = $2, welcomed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, [id, userId]
    );
}

export async function wasRecentlyAnalyzed(memberId, days) {
    const result = await query(
        `SELECT 1 FROM member_analyses
         WHERE member_id = $1 AND analyzed_at > CURRENT_TIMESTAMP - make_interval(days => $2)
         LIMIT 1`, [memberId, days]
    );
    return result.rowCount > 0;
}

// an earlier attempt of this job may have saved the analysis and then failed to post it
export async function getUnsentAnalysis(memberId, jobId) {
    const result = await query(
        `SELECT * FROM member_analyses
         WHERE member_id = $1
           AND sent_to_slack = FALSE
           AND analyzed_at >= (SELECT created_at FROM analysis_jobs WHERE id = $2)
         ORDER BY analyzed_at DESC
         LIMIT 1`, [memberId, jobId]
    );
    return toRecord(result.rows[0]);
}

export async function enqueueJob(memberId, payload = {}) {
    const result = await query(
        `INSERT INTO analysis_jobs (member_id, payload)
         VALUES ($1, $2)
         ON CONFLICT (member_id) WHERE status IN ('queued', 'running') DO NOTHING
         RETURNING id`, [memberId, JSON.stringify(payload)]
    );
    return result.rows[0]?.id ?? null;
}

// SKIP LOCKED lets more than one instance pull from this table without double-processing
export async function claimJob() {
    const result = await query(
        `UPDATE analysis_jobs
         SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = (
             SELECT id FROM analysis_jobs
             WHERE status = 'queued' AND run_after <= CURRENT_TIMESTAMP
             ORDER BY run_after, id
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING id, member_id, payload, attempts, created_at`
    );
    return result.rows[0] ?? null;
}

export async function completeJob(id) {
    await query(
        `UPDATE analysis_jobs
         SET status = 'done', last_error = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, [id]
    );
}

export async function failJob(id, error, retryInSeconds = null) {
    if (retryInSeconds === null) {
        await query(
            `UPDATE analysis_jobs
             SET status = 'failed', last_error = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`, [id, error]
        );
        return;
    }
    await query(
        `UPDATE analysis_jobs
         SET status = 'queued',
             last_error = $2,
             run_after = CURRENT_TIMESTAMP + make_interval(secs => $3),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, [id, error, retryInSeconds]
    );
}

// jobs a crashed process left behind; old enough that nobody is still working on them
export async function requeueStaleJobs(minutes = 10) {
    const result = await query(
        `UPDATE analysis_jobs
         SET status = 'queued', updated_at = CURRENT_TIMESTAMP
         WHERE status = 'running' AND updated_at < CURRENT_TIMESTAMP - make_interval(mins => $1)`, [minutes]
    );
    return result.rowCount;
}

export async function getJobCounts() {
    const result = await query('SELECT status, COUNT(*)::int AS count FROM analysis_jobs GROUP BY status');
    return Object.fromEntries(result.rows.map(row => [row.status, row.count]));
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

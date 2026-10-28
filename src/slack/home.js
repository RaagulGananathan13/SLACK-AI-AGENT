import config from '../config.js';
import log from '../logger.js';
import { getStats, getTopLeads, getJobCounts, getAnalysis } from '../db.js';
import { homeView, lockedHomeView, analysisModal } from './blocks.js';

export async function publishHome(client, userId, access) {
    if (!(await access.isAllowed(userId))) {
        await client.views.publish({ user_id: userId, view: lockedHomeView() });
        return;
    }

    const [stats, leads, queue] = await Promise.all([
        getStats(30),
        getTopLeads({ days: 7, limit: 10 }),
        getJobCounts()
    ]);

    await client.views.publish({
        user_id: userId,
        view: homeView({ stats, leads, queue, model: `${config.llm.model} (${config.llm.provider})` })
    });
}

export function registerHome(app, agent) {
    app.event('app_home_opened', async ({ event, client }) => {
        if (event.tab !== 'home') return;
        try {
            await publishHome(client, event.user, agent.access);
        } catch (error) {
            log.error('Could not publish app home:', error.message);
        }
    });

    app.action('home_refresh', async ({ ack, body, client }) => {
        await ack();
        await publishHome(client, body.user.id, agent.access);
    });

    // "View" buttons on the home tab and in /agent leads
    app.action('analysis_view', async ({ ack, action, body, client }) => {
        await ack();
        if (!(await agent.access.isAllowed(body.user.id))) return;

        const record = await getAnalysis(Number(action.value));
        if (record) await client.views.open({ trigger_id: body.trigger_id, view: analysisModal(record) });
    });
}

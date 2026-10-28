import log from '../logger.js';
import { getAnalysis, recordFeedback, markWelcomed } from '../db.js';
import { analysisMessage, welcomeModal } from './blocks.js';

// redraw the original analysis post so everyone in the channel sees what changed
export async function refreshMessage(client, analysisId, fallback = {}) {
    const record = await getAnalysis(analysisId);
    const channel = record?.slackChannel || fallback.channel;
    const ts = record?.slackTs || fallback.ts;
    if (!record || !channel || !ts) return;

    await client.chat.update({ channel, ts, ...analysisMessage(record) });
}

async function handleFeedback({ ack, action, body, client }, feedback) {
    await ack();
    const id = Number(action.value);

    await recordFeedback(id, feedback, body.user.id);
    await refreshMessage(client, id, { channel: body.channel?.id, ts: body.message?.ts });
    log.info(`Analysis ${id} marked ${feedback} by ${body.user.id}`);
}

export function registerActions(app, agent) {
    app.action('analysis_qualify', args => handleFeedback(args, 'qualified'));
    app.action('analysis_disqualify', args => handleFeedback(args, 'disqualified'));

    app.action('analysis_reanalyze', async ({ ack, action, body, client }) => {
        await ack();
        const record = await getAnalysis(Number(action.value));
        if (!record?.memberId) return;

        const result = await agent.queueAnalysis(record.memberId, {
            force: true,
            reason: 'reanalyze',
            requestedBy: body.user.id
        });
        await client.chat.postEphemeral({
            channel: body.channel.id,
            user: body.user.id,
            text: result.queued
                ? `🔄 Re-analyzing <@${record.memberId}>, the new result will be posted here.`
                : `<@${record.memberId}> is already in the queue.`
        });
    });

    app.action('analysis_welcome', async ({ ack, action, body, client }) => {
        await ack();
        const record = await getAnalysis(Number(action.value));
        if (!record) return;

        await client.views.open({ trigger_id: body.trigger_id, view: welcomeModal(record) });
    });

    app.view('welcome_dm', async ({ ack, body, view, client }) => {
        const text = view.state.values.message.text.value?.trim();
        if (!text) {
            return ack({ response_action: 'errors', errors: { message: 'The message is empty' } });
        }
        await ack();

        const { analysisId } = JSON.parse(view.private_metadata);
        const record = await getAnalysis(analysisId);

        try {
            const { channel } = await client.conversations.open({ users: record.memberId });
            await client.chat.postMessage({ channel: channel.id, text });
            await markWelcomed(analysisId, body.user.id);
            await refreshMessage(client, analysisId);
            log.info(`Welcome DM sent to ${record.memberId} by ${body.user.id}`);
        } catch (error) {
            log.error(`Could not send welcome DM for analysis ${analysisId}:`, error.message);
            // the modal is already closed, so tell the sender in their DM with the app
            await client.chat.postMessage({
                channel: body.user.id,
                text: `Couldn't send the welcome DM to <@${record.memberId}> (${error.message}).`
            });
        }
    });
}

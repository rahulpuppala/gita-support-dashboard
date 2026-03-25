const Action = require('../models/Action');
const Chat = require('../models/Chat');
const logger = require('../utils/logger');

async function handleAction(chatRecord, classification) {
  const { action_type } = classification;

  // Extract phone number from WhatsApp sender_id (format: 1234567890@c.us)
  const phone = chatRecord.sender_id ? chatRecord.sender_id.replace(/@.*$/, '') : null;

  const actionData = {
    sender_id: chatRecord.sender_id,
    sender_name: chatRecord.sender_name,
    group_id: chatRecord.group_id,
    group_name: chatRecord.group_name,
    message: chatRecord.message,
  };

  if (action_type === 'remove_host') {
    actionData.phone = phone;
    actionData.email = classification.extracted_email || null;
  }

  const action = Action.create({
    chat_id: chatRecord.id,
    action_type,
    action_data: actionData,
    priority: action_type === 'remove_host' ? 2 : 1,
  });

  Chat.updateStatus(chatRecord.id, 'escalated');
  logger.info(`Action created: ${action_type} (ID: ${action.id}) for chat ${chatRecord.id}`);

  return action;
}

async function executeAction(actionId, whatsappClient) {
  const action = Action.findById(actionId);
  if (!action) throw new Error(`Action ${actionId} not found`);

  Action.updateStatus(actionId, 'processing');

  try {
    let result;
    switch (action.action_type) {
      case 'remove_host':
        result = await executeRemoveHost(action, whatsappClient);
        break;
      case 'get_participants':
        result = await executeGetParticipants(action, whatsappClient);
        break;
      default:
        throw new Error(`Unknown action type: ${action.action_type}`);
    }

    Action.updateStatus(actionId, 'completed', result);
    logger.info(`Action ${actionId} (${action.action_type}) completed successfully`);
    return result;
  } catch (err) {
    Action.updateStatus(actionId, 'failed', null, err.message);
    logger.error(`Action ${actionId} failed: ${err.message}`);
    throw err;
  }
}

async function executeRemoveHost(action, whatsappClient) {
  if (!whatsappClient) {
    return {
      status: 'pending_manual',
      message: `Request to remove ${action.action_data.sender_name} as host in group ${action.action_data.group_name}. Requires manual admin action via WhatsApp.`,
    };
  }

  try {
    const chat = await whatsappClient.getChatById(action.action_data.group_id);
    if (!chat.isGroup) throw new Error('Not a group chat');

    await chat.demoteParticipants([action.action_data.sender_id]);
    return {
      status: 'completed',
      message: `Successfully removed ${action.action_data.sender_name} as admin/host.`,
    };
  } catch (err) {
    return {
      status: 'pending_manual',
      message: `Could not automatically remove host: ${err.message}. Requires manual admin action.`,
    };
  }
}

async function executeGetParticipants(action, whatsappClient) {
  if (!whatsappClient) {
    return {
      status: 'pending_manual',
      message: `Request for participant details in group ${action.action_data.group_name}. Requires WhatsApp client.`,
    };
  }

  try {
    const chat = await whatsappClient.getChatById(action.action_data.group_id);
    if (!chat.isGroup) throw new Error('Not a group chat');

    const participants = chat.participants.map((p) => ({
      id: p.id._serialized,
      isAdmin: p.isAdmin,
      isSuperAdmin: p.isSuperAdmin,
    }));

    return {
      status: 'completed',
      group_name: action.action_data.group_name,
      participant_count: participants.length,
      participants,
    };
  } catch (err) {
    return {
      status: 'pending_manual',
      message: `Could not fetch participants: ${err.message}. Requires manual check.`,
    };
  }
}

module.exports = { handleAction, executeAction };

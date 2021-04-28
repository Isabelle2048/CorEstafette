﻿using System;
using Microsoft.AspNetCore.SignalR;
using System.Threading.Tasks;

//Hub manages connection, group, messaging
namespace CorEstafette.Hubs
{
    public class TestHub : Hub
    {
        public async Task SubscribeTopicAsync(string topic)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, topic);
            //await Clients.Caller.SendAsync("ReceiveGroup", $"{Context.ConnectionId} has joined the group {topic}.");
        }

        public async Task UnsubscribeTopicAsync(string topic)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, topic);
            //await Clients.Caller.SendAsync("ReceiveGroup", $"{Context.ConnectionId} has lefted the group {topic}.");

        }

        public async Task PublishMessageAsync(string user, string topic, string message) //can be called by a connected client
        {
            await Clients.Group(topic).SendAsync("ReceiveMessage", user, topic, message);
        }
    }
}

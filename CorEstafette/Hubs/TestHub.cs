using System;
using Microsoft.AspNetCore.SignalR;
using System.Threading.Tasks;

//Hub manages connection, group, messaging
namespace CorEstafette.Hubs
{
    public class TestHub : Hub
    {
        public async Task SendMessage(string user, string message) //can be called by a connected client
        {
            await Clients.All.SendAsync("ReceiveMessage", user, message);
        }
        //method for client to subscribe for a topic
        //method for client to unsubscribe from a topic
        public async Task AddToGroup(string groupName)
        {
            Console.WriteLine("addToGroup invoked");
            await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
            Console.WriteLine("added to group");
            await Clients.Group(groupName).SendAsync("ReceiveGroup", $"{Context.ConnectionId} has joined the group {groupName}.");
        }

        public async Task RemoveFromGroup(string groupName)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, groupName);

            await Clients.Group(groupName).SendAsync("ReceiveGroup", $"{Context.ConnectionId} has left the group {groupName}.");
        }
        //method for client to publish a message under a topic
    }
}

import * as signalR from "@microsoft/signalr";
import { Guid } from "guid-typescript";
import { Message } from "./message";
import { IMessage } from "./IMessage";
import { ICommunicator } from "./ICommunicator";
import { Response } from "./Response";
import { IResponse } from "./IResponse";
import { IRequest } from "./IRequest";
import { Request } from "./Request";



export class Communicator implements ICommunicator {

    private userId: string;
    private connection: any;
    private connected: Promise<IResponse>;
    private callbacksByTopics: Map<string, (message: IMessage) => any>;
    private callbacksByResponder: Map<string, (request: IRequest) => Promise<any> >;

    //construct and return a timeout promise which will reject after 2 seconds
    private timeoutAsync(ms: number = 5000) : Promise<string> {
        return new Promise((resolve, reject) => setTimeout(() => {
            reject("timeout");
        }, ms));
    }

    //register the handler to the hub method
    private registerCallback(hubMethod: string, handler: Function) {
        this.connection.on(hubMethod, handler);
    }

    //initialize the connection and start it; throw an exception if connection fails
    private async establishConnection(url: string) {

        this.connection = new signalR.HubConnectionBuilder().withUrl(url).build();

        let connectionResult = this.connection.start().then(

            (connect: any) => {//connected

                let registerTask = this.connection.invoke("ConnectAsync", this.userId);
                let timeoutTask = this.timeoutAsync();
                return Promise.race([registerTask, timeoutTask]);//return a promise to be handled by the next then
            }

        ).then(

            (register: IResponse): IResponse => {//registered

                if (!register.Success) {
                    this.connection.stop();//TODO: this is also an async method; handle this here will cause another callback hell?
                }
                return register;

            }

        ).catch ((err : any) => {
            let correlationID = Guid.create().toString();
            throw new Response(correlationID, "failed to register the connection", "", "", false);
        });
        return connectionResult;
    }

    constructor(user: string) {
        this.connected = this.establishConnection("https://localhost:5001/signalRhub");//TODO: change this url later

        this.callbacksByTopics = new Map();
        this.callbacksByResponder = new Map();

        this.userId = user;
        //invoke the proper callback when the hub sends topic-based message to the client

        this.registerCallback("onPublish", (messageReceived: IMessage) => {
            let topicCallback = this.callbacksByTopics.get(messageReceived.Topic);
            topicCallback(messageReceived);//invoke callback
        });
        
        this.registerCallback("OnQuery", (requestReceived: IRequest) => {
            console.log("OnQuery" + requestReceived);
            this.onQueryTask(requestReceived);
        })
    }

    async onQueryTask(requestReceived: IRequest) {
        let respondCallback = this.callbacksByResponder.get(requestReceived.Responder);
        let resultTask = respondCallback(requestReceived);
        let timeoutTask = this.timeoutAsync(2000);
        let taskResponse = await Promise.race([resultTask, timeoutTask]).then((res: any) => {
                let responseToSend = new Response(requestReceived.CorrelationId, res, requestReceived.Sender, "", true);
                this.connection.invoke("RespondQueryAsync", responseToSend);
            },
            (rej: any) => {
                if (rej === "timeout") {
                    let responseToSend = new Response(requestReceived.CorrelationId, "Timed out", requestReceived.Sender, "", false);
                    this.connection.invoke("RespondQueryAsync", responseToSend);
                } else {
                    let responseToSend = new Response(requestReceived.CorrelationId, "Request Rejected", requestReceived.Sender, "", false);
                    this.connection.invoke("RespondQueryAsync", responseToSend);
                }
            });


      
    }

    public getConnectionState() {
        return this.connected;
    }

    publish(topic: string, message: string) {
        let correlationID = Guid.create().toString();
        let messageToSend = new Message(correlationID, message, this.userId, topic);
        console.log(messageToSend)
        this.connection.invoke("PublishAsync", messageToSend);//TODO: need a response if service is down

    }

    async subscribeAsync(topic: string, topicCallback: (message: IMessage) => any): Promise<IResponse>{

        if (this.callbacksByTopics.has(topic)) {//cannot subscribe twice

            let correlationID = Guid.create().toString();
            let duplicateSubResponse = new Response(correlationID, "cannot subscribe to the same topic multiple times", this.userId, topic, false);
            throw duplicateSubResponse;

        } else {

            let correlationID = Guid.create().toString();
            let messageToSend = new Message(correlationID, "", this.userId, topic);

            //set tasks
            let serviceTask = this.connection.invoke("SubscribeTopicAsync", messageToSend);
            let timeoutTask = this.timeoutAsync();

            //wait for one of the tasks to settle, and handle resolved and rejected cases separately
            let taskResponse : IResponse = await Promise.race([serviceTask, timeoutTask]).then((res : IResponse) => { return res; },
                (rej: any) => {
                    if (rej === "timeout") {
                        return new Response(correlationID, "timeout on subscription", this.userId, topic, false);
                    } else {
                        return new Response(correlationID, "service rejected the subscribe request", this.userId, topic, false);
                    }
            });

            if (taskResponse.Success === true) {

                //add callback function to the dictionary
                console.log("sub success");
                this.callbacksByTopics.set(topic, topicCallback);
                console.log(this.callbacksByTopics);//test
                return taskResponse; //auto wrapped in a resolved promise

            } else {

                console.log("sub failed");
                throw taskResponse;//auto wrapped in a rejected promise

            }
        }
    }

    async unsubscribeAsync(topic: string): Promise<IResponse>{
        console.log("Client called unsubscribe method");

        if (!this.callbacksByTopics.has(topic)) {

            let correlationID = Guid.create().toString();
            let duplicateUnsubResponse = new Response(correlationID, "subscribe to before unsubscribing from this topic", this.userId, topic, false);
            return new Promise<IResponse>((resolve, reject) => {
                reject(duplicateUnsubResponse);
            });

        } else {

            let correlationID = Guid.create().toString();
            let messageToSend = new Message(correlationID, "", this.userId, topic);

            let serviceTask = this.connection.invoke("UnsubscribeTopicAsync", messageToSend);
            let timeoutTask = this.timeoutAsync();

            //wait for one of the tasks to settle, and handle resolved and rejected cases separately
            let taskResponse: IResponse = await Promise.race([serviceTask, timeoutTask]).then((res: IResponse) => { return res; },
                (rej: any) => {
                    if (rej === "timeout") {
                        return new Response(correlationID, "timeout on unsubscription", this.userId, topic, false);
                    } else {
                        return new Response(correlationID, "service rejected the unsubscribe request", this.userId, topic, false);
                    }
                });

            if (taskResponse.Success === true) {

                console.log("unsub success");//test

                //remove from dictionary
                this.callbacksByTopics.delete(topic);
                console.log(this.callbacksByTopics);//test

                return taskResponse; //auto wrapped in a resolved promise

            } else {

                console.log("sub failed");
                throw taskResponse;//auto wrapped in a rejected promise

            }
        }
    }
  
    async queryAsync(responder: string, additionalData: string): Promise<IResponse> {


        let correlationID = Guid.create().toString();
        let requestToSend = new Request(correlationID, additionalData, this.userId, null, responder);
        console.log(requestToSend);
        //let serviceTask = this.connection.invoke("QueryAsync", requestToSend).catch(err => console.log(err));

        let serviceTask = this.connection.invoke("QueryAsync", requestToSend);
        let timeoutTask = this.timeoutAsync();

        let taskResponse: IResponse = await Promise.race([serviceTask, timeoutTask]).then((res: IResponse) => { return res; },
            (rej: any) => {
                if (rej === "timeout") {
                    return new Response(null, "timeout on query", this.userId, "", false);
                } else {
                    return new Response(null, "service rejected the query request", this.userId, "", false);
                }
            });

        if (taskResponse.Success === true) {

            return taskResponse; //auto wrapped in a resolved promise

        } else {

            throw taskResponse;//auto wrapped in a rejected promise

        }

    }



    async addResponder(responder: string, respondCallback: (request: IRequest) => Promise<any>): Promise<IResponse> {
        console.log("add responder");

        let registerTask: IResponse = this.connection.invoke("AddResponder", responder);
        let timeoutTask = this.timeoutAsync();

        let taskResponse: IResponse = await Promise.race([registerTask, timeoutTask]).then((res: IResponse) => { return res; },
            (rej: any) => {
                if (rej === "timeout") {
                    return new Response(null, "timeout on query", this.userId, "", false);
                } else {
                    return new Response(null, "service rejected the query request", this.userId, "", false);
                }
            });

        if (taskResponse.Success === true) {

            if (!this.callbacksByResponder.has(responder)) {
                this.callbacksByResponder.set(responder, respondCallback);
            }
            return taskResponse; //auto wrapped in a resolved promise

        } else {

            throw taskResponse;//auto wrapped in a rejected promise

        }
    }

    async disconnectAsync(): Promise<IResponse> {
        let serviceTask = this.connection.stop();
        let timeoutTask = this.timeoutAsync();
        //wait for one of the tasks to settle, and handle resolved and rejected cases separately
        let taskResponse: IResponse = await Promise.race([serviceTask, timeoutTask]).then(
            (res: void) => {
                return new Response(null, "disconnected from service", this.userId, "", true);
            },
            (rej: any) => {
                if (rej === "timeout") {
                    return new Response(null, "timeout on disconnection", this.userId, "", false);
                } else {
                    return new Response(null, "service rejected the disconnect request", this.userId, "", false);
                }
            });

        if (taskResponse.Success === true) {

            return taskResponse; //auto wrapped in a resolved promise

        } else {

            throw taskResponse;//auto wrapped in a rejected promise

        }
    }

}
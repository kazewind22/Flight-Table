'use strict';

const { dialogflow, Permission, Suggestions } = require('actions-on-google');


const functions = require('firebase-functions');
const app = dialogflow({ debug: true });
const fs = require('fs');
const latinize = require('latinize');

const Amadeus = require('amadeus');
const amadeus = new Amadeus({
  "clientId": "eSnSqvBgXYpt9GbNX1QI9HW4JiNrYRZ0",
  "clientSecret": "tCpJsyBygDXKim7B"
});

const IATA_city = JSON.parse(fs.readFileSync('data/IATA_city.json'));
const IATA_airline = JSON.parse(fs.readFileSync('data/IATA_airline.json'));
const IATA_country = JSON.parse(fs.readFileSync('data/IATA_country.json'));

app.intent("Default Welcome Intent", (conv) => {
  console.log("START WELCOME REQUEST");
  console.log(conv.user);
  conv.ask("Hello and welcome to Flight Table.")
  if (conv.user.verification === 'VERIFIED') {
    // get info for city, zip code
    const options = {
      permissions: ['DEVICE_PRECISE_LOCATION'],
      context: 'To locate your departure'
    }
    conv.contexts.set('location-permission', 1);
    conv.ask(new Permission(options));
  } else {
    conv.contexts.set('ask-place', 1);
    conv.ask("Where is your starting point?");
  }
});

app.intent("actions.intent.PERMISSION", (conv, params, confirmationGranted) => {
  console.log("START LOCATION PERMISSION REQUEST");
  const { location } = conv.device;
  console.log(location);
  if (confirmationGranted && (latinize(location.city) in IATA_city)) {
    let userCity = latinize(location.city);
    console.log("UPDATE USER LOCATION BY DEVICE LOCATION")
    return amadeus.referenceData.recommendedLocations
      .get({cityCodes: IATA_city[userCity]})
      .then(function (response) {
        console.log("RECOMMEDNATIONS RESPONESE")
        var destinations = response.data.map(location => location.name).join(', ');
        console.log(destinations);
        conv.ask(`Here are some suggested trips from ${userCity}: ${destinations}.`);
        conv.contexts.set('flights_offer_search', 3, {userCity});
        conv.ask(`Where do you want to go?`);
        console.log("RECOMMEDNATIONS RESPONESE DONE")
      })
      .catch(function (responseError) {
        console.log("ERROR in PERMISSION")
        console.log(responseError);
      });
  } else {
    conv.contexts.set('ask-place', 1);
    return conv.ask("Sorry, we can't get your location. Where is your starting point?");
  }
});

app.intent("get_current_location", (conv, params) => {
  console.log("GET_CURRENT_LOCATION");
  console.log(conv.user)
  let userCity = latinize(params['geo-city']);
  return amadeus.referenceData.recommendedLocations
    .get({cityCodes: IATA_city[userCity]})
    .then(function (response) {
      console.log("RECOMMEDNATIONS RESPONESE")
      var destinations = response.data.map(location => location.name).join(', ');
      console.log(destinations);
      conv.ask(`Here are some suggested trips from ${userCity}: ${destinations}.`);
      conv.contexts.set('flights_offer_search', 3, {userCity});
      conv.ask(`Where do you want to go?`);
      console.log("RECOMMEDNATIONS RESPONESE DONE")
    })
    .catch(function (responseError) {
      console.log("ERROR in PERMISSION")
      console.log(responseError.code);
    });
});

app.intent('flights_offer_search', (conv, params) => {
  console.log("START SEARCHING FLIGHTS")
  let context = conv.contexts.get('flights_offer_search');
  console.log(context.parameters)
  let userCity = context.parameters.userCity;
  if (userCity) {
    if (!(latinize(params['geo-city']) in IATA_city))
      return conv.close(`Sorry we can't find the flights to ${params['geo-city']}.`);
    var config = {
      originLocationCode: IATA_city[userCity],
      destinationLocationCode: IATA_city[latinize(params['geo-city'])],
      departureDate: new Date(params.date).toISOString().substr(0, 10),
      adults: '1'
    };
    console.log("search offer with config: " + JSON.stringify(config));
    conv.ask(`Searching flights offers from ${userCity} to ${params['geo-city']} on ${config.departureDate}...`);
    return amadeus.shopping.flightOffersSearch.get(config)
      .then(function (response) {
        console.log("RESPONSE FLIGHT SEARCH")
        console.log(JSON.stringify(response.data[0]))
        var directFlights = [];
        var indirectFlights = [];
        for (let i = 0; i < response.data.length; ++i) {
          var offerString = "";
          var offer = response.data[i];
          var carriers = [...new Set(offer.itineraries[0].segments.map(e => e.carrierCode))].map(e => IATA_airline[e]).join(', ');
          offerString += `flight to `;
          offerString += `${params['geo-city']} `;
          offerString += `from ${offer.price.total} ${offer.price.currency}, `;
          offerString += `operated by ${carriers}.\n`;
          if (offer.itineraries[0].segments.length == 1)
            directFlights.push(`Direct ` + offerString);
          else
            indirectFlights.push(`Indirect ` + offerString);
        }
        directFlights = [...new Set(directFlights)].map((e, i) => `${i + 1}. ${e}`);
        indirectFlights = [...new Set(indirectFlights)].map((e, i) => `${i + 1}. ${e}`);

        if (directFlights.length > 0) {
          let text = `There are ${directFlights.length} direct flights:\n`;
          for(let i = 0; i < Math.min(3, directFlights.length); ++i){
            text += directFlights[i];
          }
          text += `Do you want to know indirect flights as well?`;
          conv.contexts.set("flights_offer_search-followup", 1, {indirectFlights});
          return conv.ask(text);
        } else if(indirectFlights.length > 0) {
          conv.contexts.set("flights_offer_search-followup", 1, {indirectFlights});
          return conv.ask(`There is no direct flight. Do you want to know indirect flights?`)
        } else{
          return conv.close(`No flights available.`)
        }
      })
      .catch(function (responseError) {
        console.log("Error in FLIGHT SEARCH");
        console.log(responseError);
      });
  } else {
    conv.contexts.set('ask-place',1);
    return conv.ask("Where do you want to travel from?");
  }
});

app.intent('flights_offer_search - yes', (conv)=> {
  console.log("FLIGHT SEARCH FOLLOWUP")
  var context = conv.contexts.get('flights_offer_search-followup')
  let text = "Indirect flights available from: \n"
  for(let i = 0; i < Math.min(3, context.parameters.indirectFlights.length); ++i)
    text += context.parameters.indirectFlights[i];
  conv.ask(text);
  conv.close("Thanks for using Flight Table! See you soon!");
});

exports.flight_table = functions.https.onRequest(app);
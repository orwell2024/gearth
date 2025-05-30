// --- UI Elements ---
var dateLabel = ui.Label('Enter Forecast Creation Date (YYYY-MM-DD):');
var dateTextbox = ui.Textbox({placeholder: 'e.g., 2025-05-27', value: '2025-05-29', style: {width: '150px'}});
var timeLabel = ui.Label('Forecast Run Time (UTC):');
var timeSelect = ui.Select({
  items: [{label: '00:00 UTC', value: 'T00:00:00Z'}, {label: '06:00 UTC', value: 'T06:00:00Z'},
          {label: '12:00 UTC', value: 'T12:00:00Z'}, {label: '18:00 UTC', value: 'T18:00:00Z'}],
  value: 'T12:00:00Z', style: {width: '150px'}
});
var hourLabel = ui.Label('Select Forecast Hour (or click chart):');
var hourSlider = ui.Slider({min: 0, max: 240, value: 0, step: 3, style: {width: '180px', stretch: 'horizontal'}});
var updateButton = ui.Button({label: 'Update Forecast Date/Run', style: {width: '180px'}});
var statusLabel = ui.Label('');
var chartPanel = ui.Panel();

var controlPanel = ui.Panel({
  widgets: [dateLabel, dateTextbox, timeLabel, timeSelect, updateButton, hourLabel, hourSlider, statusLabel, chartPanel],
  layout: ui.Panel.Layout.flow('vertical'), style: {width: '220px', padding: '8px'}
});
ui.root.insert(0, controlPanel);

// --- Static Assets ---
var germany = ee.FeatureCollection('WM/geoLab/geoBoundaries/600/ADM0')
                .filter(ee.Filter.eq('shapeName', 'Germany')).first().geometry();

// "Doomer" / Max Red Palette (Dark Purple -> Red -> Bright Red/Orange)
var doomerPalette = [
  '#2a0000', // very dark blood red almost black
  '#5c0000', // deep blood red
  '#8b0000', // pure blood red
  '#b30000', // bright scarlet red
  '#d73800', // dark orange-red
  '#ff4500', // fiery orange-red (orange-red)
  '#ff6600', // bright orange
  '#ff8c00', // dark orange
  '#ffaa00', // golden orange
  '#ffd700', // gold
  '#ffff00'  // bright yellow (extreme heat)
];
// Visualization parameters for the main raster map
var rasterVisParams = {min: 15, max: 34, palette: doomerPalette}; // Adjusted max for more red emphasis

// Major German Cities (approximate locations for point statistics)
// You can get more precise locations or a more comprehensive list if needed.
var cities = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Point(13.4050, 52.5200), {name: 'Berlin'}),
  ee.Feature(ee.Geometry.Point(9.9937, 53.5511), {name: 'Hamburg'}),
  ee.Feature(ee.Geometry.Point(11.5820, 48.1351), {name: 'Munich'}),
  ee.Feature(ee.Geometry.Point(6.9603, 50.9375), {name: 'Cologne'}),
  ee.Feature(ee.Geometry.Point(8.6821, 50.1109), {name: 'Frankfurt'})
]);

// --- Global Variables ---
var currentForecastCollection = null;
var currentMapLayer = null;
var currentCityTempLayer = null; // To store the city temperature labels layer

// --- Functions ---
function handleChartClick(xValue, yValue, seriesName) {
  if (xValue === null || xValue === undefined) return;
  var clickedHour = Math.round(xValue);
  var min = hourSlider.getMin(); var max = hourSlider.getMax();
  clickedHour = Math.max(min, Math.min(max, clickedHour));
  hourSlider.setValue(clickedHour, true);
  statusLabel.setValue('Map updated to hour: ' + clickedHour);
}

function updateMapLayerForHour() {
  if (!currentForecastCollection || hourSlider.getValue() === null) return;

  var selectedHour = hourSlider.getValue();
  var imageToShow = currentForecastCollection
                      .filter(ee.Filter.eq('forecast_hours', selectedHour))
                      .first();

  if (currentMapLayer) Map.remove(currentMapLayer);
  if (currentCityTempLayer) Map.remove(currentCityTempLayer); // Remove old city temps

  if (imageToShow) {
    imageToShow = ee.Image(imageToShow);
    var newLayer = ui.Map.Layer(imageToShow.clip(germany), rasterVisParams, 'Temp at hour ' + selectedHour);
    Map.add(newLayer);
    currentMapLayer = newLayer;

    // Add City Temperatures
    var cityTemps = imageToShow.reduceRegions({
      collection: cities,
      reducer: ee.Reducer.first(), // Get the value at the point (or mean if buffered)
      scale: 10000 // Scale for reduction, should be appropriate for image resolution
    });

    // Function to create text labels (this is a bit of a GEE workaround for nice labels)
    // It creates an image with the text painted on it.
    var addTextLabels = function(fcWithValues, valueProperty, nameProperty) {
      var styledFeatures = fcWithValues.map(function(feature) {
        var value = feature.get(valueProperty);
        var name = feature.get(nameProperty);
        // Format the value, handle nulls
        var labelText = name + ': ' + (value !== null ? ee.Number(value).format('%.0f').getInfo() + '°' : 'N/A');
        return feature.set('label', labelText);
      });
      // Style for the labels
      var textStyle = {fontSize: '12px', color: '000000', fontWeight: 'bold', outlineColor: 'FFFFFF', outlineWidth: 2.5, outlineOpacity: 0.6};
      var textLayer = ee.Image().paint(styledFeatures, 'label', 2).visualize(textStyle); // Paint label property
      return textLayer;
    };
    
    // Filter out cities that might be outside the image extent or have no data
    var validCityTemps = cityTemps.filter(ee.Filter.notNull(['temperature_2m_sfc']));

    if (validCityTemps.size().getInfo() > 0) {
        currentCityTempLayer = addTextLabels(validCityTemps, 'temperature_2m_sfc', 'name');
        Map.addLayer(currentCityTempLayer, {}, 'City Temps (°C) hr ' + selectedHour);
    }


  } else {
    if (currentMapLayer) { Map.remove(currentMapLayer); currentMapLayer = null; }
    if (currentCityTempLayer) { Map.remove(currentCityTempLayer); currentCityTempLayer = null; }
  }
}

function loadAndDisplayNewForecastRun() {
  Map.clear(); chartPanel.clear(); statusLabel.setValue('Loading forecast...');
  Map.addLayer(germany, {color: 'black', fillColor: 'FFFFFF00'}, 'Germany Outline', true, 0.5);

  var dateStr = dateTextbox.getValue(); var timeStr = timeSelect.getValue();
  if (!dateStr || !timeStr) { statusLabel.setValue('Error: Date or time missing.'); return; }
  var creationDateTimeStr = dateStr + timeStr; var creationTimeMillis;
  try { creationTimeMillis = ee.Date(creationDateTimeStr).millis(); }
  catch (e) { statusLabel.setValue('Error: Invalid date. Use YYYY-MM-DD.'); return; }

  currentForecastCollection = ee.ImageCollection('ECMWF/NRT_FORECAST/IFS/OPER')
                                .filter(ee.Filter.eq('creation_time', creationTimeMillis))
                                .select('temperature_2m_sfc').sort('forecast_hours');
  var nFound = currentForecastCollection.size().getInfo();
  statusLabel.setValue('Found ' + nFound + ' images for ' + creationDateTimeStr);

  if (nFound > 0) {
    var forecastHoursList = ee.List(currentForecastCollection.aggregate_array('forecast_hours')).sort();
    var minHour = ee.Number(forecastHoursList.get(0)).getInfo();
    var maxHour = ee.Number(forecastHoursList.get(-1)).getInfo();
    var step = 1;
    if (nFound > 1) {
        var firstVal = ee.Number(forecastHoursList.get(0)); var secondVal = ee.Number(forecastHoursList.get(1));
        var diff = secondVal.subtract(firstVal).getInfo(); if (diff > 0) step = diff;
    }
    hourSlider.setMin(minHour); hourSlider.setMax(maxHour);
    hourSlider.setStep(step); hourSlider.setValue(minHour, false);
    hourSlider.onChange(updateMapLayerForHour);
    updateMapLayerForHour();

    var chart = ui.Chart.image.series({
      imageCollection: currentForecastCollection, region: germany,
      reducer: ee.Reducer.mean(), scale: 25000, xProperty: 'forecast_hours',
    }).setOptions({
      title: 'Avg Raw Values (Click to update map)\nRun: ' + creationDateTimeStr,
      vAxis: {title: 'Raw Band Value (units?)'}, hAxis: {title: 'Forecast Hours'}
    });
    chart.onClick(handleChartClick); chartPanel.add(chart);

    var firstForecastImageRaw = currentForecastCollection.filter(ee.Filter.eq('forecast_hours', minHour)).first();
    var statsRawGermany = firstForecastImageRaw.reduceRegion({
      reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true).combine(ee.Reducer.count(), '', true),
      geometry: germany, scale: 10000, maxPixels: 1e9
    });
    print('DIAGNOSTIC for ' + creationDateTimeStr + ' run (hour ' + minHour + '):', statsRawGermany);
  } else {
    print('No forecast images found for ' + creationDateTimeStr);
    Map.addLayer(germany, {}, 'Germany (no forecast data)');
    if (currentMapLayer) { Map.remove(currentMapLayer); currentMapLayer = null; }
    if (currentCityTempLayer) { Map.remove(currentCityTempLayer); currentCityTempLayer = null; }
    hourSlider.setMin(0); hourSlider.setMax(0); hourSlider.setValue(0, false); hourSlider.unlisten('change');
  }
}
updateButton.onClick(loadAndDisplayNewForecastRun);
loadAndDisplayNewForecastRun();

// --- Configuration ---
var START_VALIDITY_DATE_STR = '2025-04-01';
var END_VALIDITY_DATE_STR = '2025-04-20';
var LEAD_TIME_LONG_HOURS = 312;
var LEAD_TIME_SHORT_HOURS = 24;
var FORECAST_RUN_TIME_OF_DAY_UTC = 'T00:00:00Z';
var germany = ee.FeatureCollection('WM/geoLab/geoBoundaries/600/ADM0')
               .filter(ee.Filter.eq('shapeName', 'Germany'))
               .first()
               .geometry();

// Helper function to get mean raw temperature for a specific creation time and forecast hour
function getMeanRawEcmwfTemp(creationDateTimeStr, forecastHour) {
  var creationTimeMillis = ee.Date(creationDateTimeStr).millis();
  var forecastImageRaw = ee.ImageCollection('ECMWF/NRT_FORECAST/IFS/OPER')
      .filter(ee.Filter.eq('creation_time', creationTimeMillis))
      .filter(ee.Filter.eq('forecast_hours', forecastHour))
      .select('temperature_2m_sfc')
      .first();
  // This If will return either an ee.Number or a GEE server-side null
  return ee.Algorithms.If(
      forecastImageRaw,
      ee.Image(forecastImageRaw).reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: germany,
          scale: 10000, maxPixels: 1e9, tileScale: 4
      }).get('temperature_2m_sfc'),
      null);
}

// --- Main Logic ---
var startDate = ee.Date(START_VALIDITY_DATE_STR);
var endDate = ee.Date(END_VALIDITY_DATE_STR);
var nDays = endDate.difference(startDate, 'day').add(1);

if (nDays.getInfo() <= 0) {
  print('Error: END_VALIDITY_DATE_STR must be on or after START_VALIDITY_DATE_STR.');
} else {
  print('Processing ' + nDays.getInfo() + ' validity dates from ' + START_VALIDITY_DATE_STR + ' to ' + END_VALIDITY_DATE_STR);
  var validityDateList = ee.List.sequence(0, nDays.subtract(1))
    .map(function(dayOffset) { return startDate.advance(dayOffset, 'day'); });

  // Step 1: Get the raw forecast values for long and short leads
  var initialTimeSeriesData = validityDateList.map(function(validityDateEeDate) {
    validityDateEeDate = ee.Date(validityDateEeDate);
    var targetValidityDateTime = ee.Date(validityDateEeDate.format('YYYY-MM-dd').cat(FORECAST_RUN_TIME_OF_DAY_UTC));

    var creationDateTimeLongLead = targetValidityDateTime.advance(-LEAD_TIME_LONG_HOURS, 'hour');
    var creationDateTimeStrLongLead = ee.String(creationDateTimeLongLead.format('YYYY-MM-dd')).cat(FORECAST_RUN_TIME_OF_DAY_UTC);
    var valueLongLead = getMeanRawEcmwfTemp(creationDateTimeStrLongLead, LEAD_TIME_LONG_HOURS);

    var creationDateTimeShortLead = targetValidityDateTime.advance(-LEAD_TIME_SHORT_HOURS, 'hour');
    var creationDateTimeStrShortLead = ee.String(creationDateTimeShortLead.format('YYYY-MM-dd')).cat(FORECAST_RUN_TIME_OF_DAY_UTC);
    var valueShortLead = getMeanRawEcmwfTemp(creationDateTimeStrShortLead, LEAD_TIME_SHORT_HOURS);

    return ee.Feature(null, {
      'system:time_start': targetValidityDateTime.millis(), // ee.Number (timestamp)
      'value_long_lead': valueLongLead,  // ee.Number or GEE null
      'value_short_lead': valueShortLead // ee.Number or GEE null
    });
  });
  initialTimeSeriesData = ee.FeatureCollection(initialTimeSeriesData);

  // Step 2: Evaluate to bring data client-side, then calculate differences and stats
  var maxFeatures = nDays.getInfo(); // Get number of days for toList limit
  print('Fetching data to client for processing (' + maxFeatures + ' features)...');

  initialTimeSeriesData.toList(maxFeatures).evaluate(function(featureListClient, error) {
    if (error) {
      print('Error evaluating feature list: ' + error);
      return;
    }
    if (!featureListClient || featureListClient.length === 0) {
        print('No features returned after initial server-side processing.');
        return;
    }
    print('Client-side processing ' + featureListClient.length + ' features...');

    var chartableFeaturesClient = [];
    var differencesArray = []; // For stats

    for (var i = 0; i < featureListClient.length; i++) {
      var props = featureListClient[i].properties;
      var longVal = props.value_long_lead;   // JavaScript number or null
      var shortVal = props.value_short_lead; // JavaScript number or null
      var timeStart = props['system:time_start']; // JavaScript number (timestamp)
      var diff = null;

      // Client-side null check is straightforward
      if (longVal !== null && shortVal !== null) {
        diff = longVal - shortVal; // Client-side subtraction
        differencesArray.push(diff); // Add to array for stats
        chartableFeaturesClient.push(ee.Feature(null, {
          'system:time_start': timeStart,
          'fcst_diff_312h_minus_24h': diff
        }));
      }
    }

    if (chartableFeaturesClient.length === 0) {
      print('No valid difference data to calculate stats or chart after client-side processing.');
      return;
    }

    // Client-side Stats Calculation
    if (differencesArray.length > 0) {
      var sum = differencesArray.reduce(function(a, b) { return a + b; }, 0);
      var meanDiff = sum / differencesArray.length;
      var sqDiffs = differencesArray.map(function(value){ return Math.pow(value - meanDiff, 2); });
      var variance = sqDiffs.reduce(function(a,b){ return a + b; }, 0) / differencesArray.length;
      var stdDevDiff = Math.sqrt(variance);

      print('--- Statistics of (312h Forecast - 24h Forecast) (Client-side) ---');
      print('Mean Difference:', meanDiff);
      print('Standard Deviation of Difference:', stdDevDiff);
      print('Number of valid difference points for stats: ' + differencesArray.length);
    } else {
      print('--- Statistics of (312h Forecast - 24h Forecast) ---');
      print('Mean Difference: N/A (no valid difference points)');
      print('Standard Deviation of Difference: N/A (no valid difference points)');
    }

    // Create FeatureCollection from client-side features for charting
    var validTimeSeriesDataClient = ee.FeatureCollection(chartableFeaturesClient);

    print('Plotting ' + chartableFeaturesClient.length + ' difference points.');
    var differenceChart = ui.Chart.feature.byFeature({
      features: validTimeSeriesDataClient,
      xProperty: 'system:time_start',
      yProperties: ['fcst_diff_312h_minus_24h']
    }).setOptions({
      title: 'Difference: (312h Fcst - 24h Fcst) Raw Values - Germany\nTarget Validity Time: ' + FORECAST_RUN_TIME_OF_DAY_UTC.slice(1,6) + ' UTC',
      vAxis: {title: 'Difference in Raw temperature_2m_sfc Value'},
      hAxis: {title: 'Forecast Validity Date', format: 'YYYY-MM-dd', gridlines: {count: -1}},
      series: { 0: {label: 'Difference (312h - 24h)', color: 'purple', lineWidth: 2, pointSize: 3}},
      legend: {position: 'bottom'},
      interpolateNulls: false
    });
    print(differenceChart);
  });
}

// --- Configuration ---
var START_VALIDITY_DATE_STR = '2025-01-01'; // Start of the period for which forecasts are VALID
var END_VALIDITY_DATE_STR = '2025-01-11';   // End of the period (inclusive)

// Define the three lead times we want to compare
var LEAD_TIME_VERY_LONG_HOURS = 312; // e.g., 13 days
var LEAD_TIME_MEDIUM_HOURS = 48;    // e.g., 2 days
var LEAD_TIME_SHORT_HOURS = 24;     // e.g., 1 day

var FORECAST_RUN_TIME_OF_DAY_UTC = 'T00:00:00Z'; // We'll assume forecasts are for 00Z on the validity day,
                                             // so we use 00Z model runs.
var germany = ee.FeatureCollection('WM/geoLab/geoBoundaries/600/ADM0')
               .filter(ee.Filter.eq('shapeName', 'Germany'))
               .first()
               .geometry();

// Helper function to get mean raw temperature for a specific creation time and forecast hour
function getMeanRawEcmwfTemp(creationDateTimeStr, forecastHour) {
  var creationTimeMillis = ee.Date(creationDateTimeStr).millis();
  var forecastImageRaw = ee.ImageCollection('ECMWF/NRT_FORECAST/IFS/OPER')
      .filter(ee.Filter.eq('creation_time', creationTimeMillis))
      .filter(ee.Filter.eq('forecast_hours', forecastHour))
      .select('temperature_2m_sfc')
      .first();
  return ee.Algorithms.If(
      forecastImageRaw,
      ee.Image(forecastImageRaw).reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: germany,
          scale: 10000,
          maxPixels: 1e9,
          tileScale: 4
      }).get('temperature_2m_sfc'),
      null);
}

// --- Main Logic ---
var startDate = ee.Date(START_VALIDITY_DATE_STR);
var endDate = ee.Date(END_VALIDITY_DATE_STR);
var nDays = endDate.difference(startDate, 'day').add(1);

if (nDays.getInfo() <= 0) {
  print('Error: END_VALIDITY_DATE_STR must be on or after START_VALIDITY_DATE_STR.');
} else {
  print('Processing ' + nDays.getInfo() + ' validity dates from ' + START_VALIDITY_DATE_STR + ' to ' + END_VALIDITY_DATE_STR);
  var validityDateList = ee.List.sequence(0, nDays.subtract(1))
    .map(function(dayOffset) {
      return startDate.advance(dayOffset, 'day'); // These are ee.Date objects for VALIDITY
    });

  var timeSeriesData = validityDateList.map(function(validityDateEeDate) {
    validityDateEeDate = ee.Date(validityDateEeDate);
    var targetValidityDateTime = ee.Date(validityDateEeDate.format('YYYY-MM-dd').cat(FORECAST_RUN_TIME_OF_DAY_UTC));

    // --- Very Long Lead Forecast (312h) ---
    var creationDateTimeVeryLongLead = targetValidityDateTime.advance(-LEAD_TIME_VERY_LONG_HOURS, 'hour');
    var creationDateTimeStrVeryLongLead = ee.String(creationDateTimeVeryLongLead.format('YYYY-MM-dd'))
                                        .cat(FORECAST_RUN_TIME_OF_DAY_UTC);
    var valueVeryLongLead = getMeanRawEcmwfTemp(creationDateTimeStrVeryLongLead, LEAD_TIME_VERY_LONG_HOURS);

    // --- Medium Lead Forecast (e.g., 48h) ---
    var creationDateTimeMediumLead = targetValidityDateTime.advance(-LEAD_TIME_MEDIUM_HOURS, 'hour');
    var creationDateTimeStrMediumLead = ee.String(creationDateTimeMediumLead.format('YYYY-MM-dd'))
                                        .cat(FORECAST_RUN_TIME_OF_DAY_UTC);
    var valueMediumLead = getMeanRawEcmwfTemp(creationDateTimeStrMediumLead, LEAD_TIME_MEDIUM_HOURS);

    // --- Short Lead Forecast (e.g., 24h) ---
    var creationDateTimeShortLead = targetValidityDateTime.advance(-LEAD_TIME_SHORT_HOURS, 'hour');
    var creationDateTimeStrShortLead = ee.String(creationDateTimeShortLead.format('YYYY-MM-dd'))
                                         .cat(FORECAST_RUN_TIME_OF_DAY_UTC);
    var valueShortLead = getMeanRawEcmwfTemp(creationDateTimeStrShortLead, LEAD_TIME_SHORT_HOURS);

    return ee.Feature(null, {
      'system:time_start': targetValidityDateTime.millis(), // X-axis is the common VALIDITY date
      'fcst_312h_value': valueVeryLongLead,  // New property name
      'fcst_48h_value': valueMediumLead,    // Renamed for clarity
      'fcst_24h_value': valueShortLead     // Renamed for clarity
    });
  });

  var validTimeSeriesData = ee.FeatureCollection(timeSeriesData);
  // print('Time Series Data (first 2):', validTimeSeriesData.limit(2));

  validTimeSeriesData.size().evaluate(function(size, error) {
    if (error) { print('Error getting size: ' + error); }
    else if (size > 0) {
      print('Plotting ' + size + ' points.');
      var comparisonChart = ui.Chart.feature.byFeature({
        features: validTimeSeriesData,
        xProperty: 'system:time_start',
        yProperties: ['fcst_312h_value', 'fcst_48h_value', 'fcst_24h_value'] // Added new property
      }).setOptions({
        title: 'ECMWF NRT Raw Forecast Comparison - Germany\nTarget Validity Time: ' + FORECAST_RUN_TIME_OF_DAY_UTC.slice(1,6) + ' UTC',
        vAxis: {title: 'Raw temperature_2m_sfc Value'},
        hAxis: {title: 'Forecast Validity Date', format: 'YYYY-MM-dd', gridlines: {count: -1}},
        series: { // Define series for each lead time
          0: {label: LEAD_TIME_VERY_LONG_HOURS + 'h Lead Fcst', color: 'green', lineWidth: 2, pointSize: 3},
          1: {label: LEAD_TIME_MEDIUM_HOURS + 'h Lead Fcst', color: 'blue', lineWidth: 2, pointSize: 3},
          2: {label: LEAD_TIME_SHORT_HOURS + 'h Lead Fcst', color: 'red', lineWidth: 2, lineDashStyle: [4,4], pointSize: 3}
        },
        legend: {position: 'bottom'},
        interpolateNulls: false
      });
      print(comparisonChart);
    } else {
      print('No data to chart.');
    }
  });

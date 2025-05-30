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

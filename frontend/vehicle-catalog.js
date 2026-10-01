(function exposeVehicleCatalog(root, catalog) {
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.TallerVehicleCatalog = catalog;
})(globalThis, {
  Acura: ['Integra', 'MDX', 'RDX', 'TLX', 'ZDX'], Audi: ['A3', 'A4', 'A5', 'A6', 'Q3', 'Q5', 'Q7', 'Q8', 'e-tron'],
  BMW: ['Serie 1', 'Serie 2', 'Serie 3', 'Serie 4', 'Serie 5', 'X1', 'X3', 'X5', 'X6', 'iX'],
  Buick: ['Enclave', 'Encore', 'Envision', 'Envista'], BYD: ['Dolphin', 'King', 'Seagull', 'Shark', 'Song Plus', 'Tang', 'Yuan Plus'],
  Cadillac: ['CT4', 'CT5', 'Escalade', 'Lyriq', 'XT4', 'XT5', 'XT6'], Changan: ['CS35 Plus', 'CS55 Plus', 'CS75 Plus', 'Hunter', 'UNI-T'],
  Chevrolet: ['Aveo', 'Blazer', 'Captiva', 'Colorado', 'Equinox', 'Groove', 'Onix', 'S10', 'Silverado', 'Tracker', 'Traverse'],
  Chrysler: ['Pacifica'], Cupra: ['Ateca', 'Formentor', 'Leon', 'Terramar'], Dodge: ['Attitude', 'Charger', 'Durango', 'Journey'],
  Fiat: ['Argo', 'Fastback', 'Mobi', 'Pulse', 'Strada'], Ford: ['Bronco', 'Edge', 'Escape', 'Explorer', 'F-150', 'Maverick', 'Mustang', 'Ranger', 'Territory'],
  GAC: ['Emzoom', 'GS3', 'GS4', 'GS8', 'Empow'], GMC: ['Acadia', 'Canyon', 'Sierra', 'Terrain', 'Yukon'],
  'Great Wall': ['Haval H6', 'Haval Jolion', 'Poer', 'Tank 300'], Honda: ['Accord', 'BR-V', 'City', 'Civic', 'CR-V', 'HR-V', 'Odyssey', 'Pilot'],
  Hyundai: ['Creta', 'Elantra', 'Grand i10', 'Palisade', 'Santa Fe', 'Tucson'], Infiniti: ['QX50', 'QX55', 'QX60', 'QX80'],
  Isuzu: ['D-Max', 'ELF'], JAC: ['E10X', 'Frison', 'J7', 'JAC 4', 'Sei2', 'Sei4 Pro'], Jaguar: ['E-Pace', 'F-Pace', 'F-Type', 'I-Pace'],
  Jeep: ['Gladiator', 'Grand Cherokee', 'Renegade', 'Wrangler'], Jetour: ['Dashing', 'X70', 'X70 Plus', 'X90 Plus'],
  Kia: ['Forte', 'K3', 'K4', 'Niro', 'Seltos', 'Sonet', 'Sportage', 'Telluride'], 'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover Evoque', 'Range Rover Sport'],
  Lexus: ['ES', 'GX', 'NX', 'RX', 'UX'], Lincoln: ['Aviator', 'Corsair', 'Nautilus', 'Navigator'], Mazda: ['CX-3', 'CX-30', 'CX-5', 'CX-50', 'CX-90', 'Mazda2', 'Mazda3', 'MX-5'],
  'Mercedes-Benz': ['Clase A', 'Clase C', 'Clase E', 'GLA', 'GLB', 'GLC', 'GLE', 'Sprinter'], MG: ['MG3', 'MG4', 'MG5', 'MG GT', 'RX5', 'ZS'],
  MINI: ['Clubman', 'Countryman', 'Cooper'], Mitsubishi: ['L200', 'Mirage', 'Montero Sport', 'Outlander', 'Xpander'],
  Nissan: ['Frontier', 'Kicks', 'March', 'NP300', 'Pathfinder', 'Sentra', 'Versa', 'X-Trail'], Omoda: ['C5', 'C5 EV', 'C7'],
  Peugeot: ['2008', '3008', '5008', 'Partner', 'Rifter'], Porsche: ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'],
  RAM: ['700', '1200', '1500', '2500', 'ProMaster'], Renault: ['Duster', 'Kardian', 'Koleos', 'Kwid', 'Oroch'],
  SEAT: ['Arona', 'Ateca', 'Ibiza', 'Leon'], Subaru: ['Crosstrek', 'Forester', 'Impreza', 'Outback', 'WRX'],
  Suzuki: ['Baleno', 'Ertiga', 'Fronx', 'Jimny', 'Swift', 'Vitara'], Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y', 'Cybertruck'],
  Toyota: ['Avanza', 'Camry', 'Corolla', 'Corolla Cross', 'Hilux', 'RAV4', 'Sienna', 'Tacoma', 'Yaris'],
  Volkswagen: ['Amarok', 'Golf', 'Jetta', 'Nivus', 'Taigun', 'T-Cross', 'Tiguan', 'Vento', 'Virtus'],
  Volvo: ['EX30', 'S60', 'XC40', 'XC60', 'XC90'], Zeekr: ['001', 'X']
});

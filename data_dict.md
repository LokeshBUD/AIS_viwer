1. Stream Metadata
   Every packet coming through a digital stream typically contains structural metadata wrapper fields to help you parse the message:

MessageType / MessageID: An integer (1 to 27) identifying the ITU-R M.1371 standard AIS message type. For example:
aisstream.io

Messages 1, 2, 3: Class A Position Reports (Dynamic).
www.navcen.uscg.gov

Message 5: Class A Static and Voyage Data.
www.confluent.io

Message 18/24: Class B Position and Static Data (used by smaller/pleasure vessels).

Timestamp: The precise UTC time added by the receiving terrestrial station or satellite when the message hit the antenna network.

2. Core Identification & Static Fields
   These fields identify who and what the vessel is. They do not change frequently and are usually broadcast every 6 minutes.
   globalfishingwatch.org

- 1

MMSI (Maritime Mobile Service Identity): A unique 9-digit identification number assigned to a ship's radio station. The first three digits indicate the country of origin (Maritime Identification Digits). This acts as the unique key for tracking a ship across the database.www.confluent.io

- 1

IMO Number: A permanent 7-digit identifier assigned to the ship's hull by the International Maritime Organization. Unlike the MMSI, the IMO number remains unchanged even if the ship changes flags, owners, or names.
www.navcen.uscg.gov

Ship Name: The name of the vessel (up to 20 characters in text format).
www.nautinst.org

Call Sign: The unique international radio call sign assigned to the vessel by its home country's licensing authority.
globalfishingwatch.org

Vessel Type: An integer code mapping to the type of ship and cargo (e.g., Cargo, Tanker, Passenger, Tug, Pilot Vessel, Fishing, Pleasure Craft).
www.navcen.uscg.gov

Dimensions (Length & Beam): The physical length and width of the vessel in meters, derived from the position of the reference GPS antenna relative to the bow, stern, port, and starboard.

3. Dynamic Fields (Kinematics)
   www.nautinst.org
   These fields track where the ship is and how it is moving. They are sent frequently—ranging from every 2 seconds for high-speed vessels to every 3 minutes for anchored ships.
   www.nautinst.org

Latitude & Longitude: The current spatial coordinates of the vessel, typically parsed as a signed float (decimal degrees) based on the WGS84 datum.
www.confluent.io

SOG (Speed Over Ground): The actual speed of the vessel relative to the Earth's surface (measured in knots), with a precision of 0.1 knots.
www.navcen.uscg.gov

COG (Course Over Ground): The actual direction of motion relative to true north, measured in degrees (0.0° to 359.9°). This might differ from the direction the ship’s bow is pointing due to wind or water currents.

True Heading: The absolute direction the vessel's bow is pointing (0° to 359°), pulled directly from the onboard gyrocompass or digital compass.
servicedocs-sm.kpler.com

ROT (Rate of Turn): The speed at which the ship is turning, measured in degrees per minute (either left or right). This helps collision-avoidance algorithms determine if a ship is executing an aggressive maneuver.
servicedocs-sm.kpler.com

Navigation Status: An integer code reflecting the current operational status of the ship. Common values include:
www.navcen.uscg.gov

0: Underway using engine

1: At anchor

2: Not under command

3: Restricted manoeuvrability

5: Moored

7: Engaged in fishing

4. Voyage-Related Fields
   These fields provide context regarding the ship's current mission or journey and are manually configured by the ship's crew.

Destination: The text string denoting the planned port of call (e.g., "SGP SIN" or "ROTTERDAM"). Because this is typed manually by operators, it can sometimes contain minor typos or variations.

ETA (Estimated Time of Arrival): The predicted arrival date and time at the destination port, broadcast in UTC format (MM-DD HH:MM).
www.navcen.uscg.gov

Draught: The vertical distance between the waterline and the bottom of the hull, expressed in meters. This changes depending on how heavily the ship is loaded with cargo and helps port authorities ensure the ship won't run aground in shallow waters.

ko
